#include "session/routine_call.hpp"

#include "session/dbms_output.hpp"
#include "session/tx.hpp"
#include "util/dpi_error.hpp"
#include "util/idgen.hpp"
#include "util/ident.hpp"
#include "util/lob.hpp"
#include "util/stmt_guard.hpp"
#include "util/utf8.hpp"

#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace niuma::oracle::session {
namespace {

class VarGuard {
 public:
  explicit VarGuard(dpiVar* v = nullptr) : var_(v) {}
  ~VarGuard() { Reset(); }
  VarGuard(const VarGuard&) = delete;
  VarGuard& operator=(const VarGuard&) = delete;
  VarGuard(VarGuard&& o) noexcept : var_(o.var_) { o.var_ = nullptr; }
  VarGuard& operator=(VarGuard&& o) noexcept {
    if (this != &o) {
      Reset();
      var_ = o.var_;
      o.var_ = nullptr;
    }
    return *this;
  }
  void Reset(dpiVar* v = nullptr) {
    if (var_) {
      dpiVar_release(var_);
    }
    var_ = v;
  }
  dpiVar* Get() const { return var_; }

 private:
  dpiVar* var_ = nullptr;
};

class LobGuard {
 public:
  LobGuard() = default;
  ~LobGuard() { Reset(); }
  LobGuard(const LobGuard&) = delete;
  LobGuard& operator=(const LobGuard&) = delete;
  LobGuard(LobGuard&& o) noexcept : lob_(o.lob_) { o.lob_ = nullptr; }
  LobGuard& operator=(LobGuard&& o) noexcept {
    if (this != &o) {
      Reset();
      lob_ = o.lob_;
      o.lob_ = nullptr;
    }
    return *this;
  }
  void Reset(dpiLob* l = nullptr) {
    if (lob_) {
      dpiLob_release(lob_);
    }
    lob_ = l;
  }
  dpiLob* Get() const { return lob_; }

 private:
  dpiLob* lob_ = nullptr;
};

struct CallTimeoutScope {
  dpiConn* conn = nullptr;
  uint32_t previous = 0;
  bool applied = false;

  CallTimeoutScope(dpiConn* c, int timeout_ms) : conn(c) {
    if (!conn || timeout_ms <= 0) {
      return;
    }
    if (dpiConn_getCallTimeout(conn, &previous) < 0) {
      previous = 0;
    }
    if (dpiConn_setCallTimeout(conn, static_cast<uint32_t>(timeout_ms)) == 0) {
      applied = true;
    }
  }

  ~CallTimeoutScope() {
    if (applied && conn) {
      dpiConn_setCallTimeout(conn, previous);
    }
  }

  CallTimeoutScope(const CallTimeoutScope&) = delete;
  CallTimeoutScope& operator=(const CallTimeoutScope&) = delete;
};

enum class BindKind {
  Number,      // NUMBER 用字符串绑定保精度
  Varchar,     // VARCHAR2/CHAR/NVARCHAR2
  Clob,        // CLOB/NCLOB → 临时 LOB
  Blob,        // BLOB → 临时 LOB（网格 hex）
  Raw,         // RAW（网格 hex）
  Date,        // DATE
  Timestamp,   // TIMESTAMP / TIMESTAMP LTZ
  TimestampTz, // TIMESTAMP WITH TIME ZONE
  Boolean,     // BOOLEAN
  RefCursor,   // SYS_REFCURSOR / REF CURSOR（OUT → 结果集）
};

struct BindSlot {
  VarGuard var;
  LobGuard lob;  // Clob 时持有临时 LOB，寿命覆盖 execute
  dpiData* data = nullptr;
  std::string column_name;
  std::string data_type_label;
  bool report_out = false;
  BindKind kind = BindKind::Varchar;
};

std::string DpiError(dpiContext* ctx) {
  return util::FormatDpiError(ctx, "oracle: routine.call error");
}

bool SetCurrentSchema(dpiContext* ctx, dpiConn* conn, const std::string& schema, std::string& error) {
  if (schema.empty()) {
    return true;
  }
  if (!util::IsSafeIdent(schema)) {
    error = "oracle: invalid schema name";
    return false;
  }
  const std::string quoted = util::QuoteIdent(schema);
  const std::string alter = "ALTER SESSION SET CURRENT_SCHEMA = " + quoted;
  util::StmtGuard alter_stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(conn, 0, alter.c_str(), static_cast<uint32_t>(alter.size()), nullptr, 0,
                          &raw) < 0) {
    error = DpiError(ctx);
    return false;
  }
  alter_stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(alter_stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    error = DpiError(ctx);
    return false;
  }
  return true;
}

std::string NormalizeMode(std::string mode) {
  std::string compact;
  for (char c : mode) {
    if (std::isspace(static_cast<unsigned char>(c))) {
      continue;
    }
    compact.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(c))));
  }
  if (compact == "OUT") {
    return "OUT";
  }
  if (compact == "INOUT" || compact == "IN/OUT") {
    return "INOUT";
  }
  if (compact.find("OUT") != std::string::npos) {
    return compact.find("IN") != std::string::npos ? "INOUT" : "OUT";
  }
  return "IN";
}

std::string DisplayName(const RoutineCallArg& a, int ordinal) {
  if (!a.name.empty()) {
    return a.name;
  }
  return "p" + std::to_string(ordinal);
}

std::string Trim(const std::string& s) {
  size_t b = 0;
  size_t e = s.size();
  while (b < e && std::isspace(static_cast<unsigned char>(s[b]))) {
    ++b;
  }
  while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) {
    --e;
  }
  return s.substr(b, e - b);
}

std::string Upper(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  }
  return s;
}

/** 规范化类型名：去掉精度，折叠 WITH TIME ZONE 等多词类型。 */
std::string NormalizedTypeKey(const std::string& type) {
  std::string t = Upper(Trim(type));
  // 去掉括号精度 VARCHAR2(50) / NUMBER(10,2)
  const auto paren = t.find('(');
  if (paren != std::string::npos) {
    t = Trim(t.substr(0, paren));
  }
  // 折叠空白
  std::string out;
  bool space = false;
  for (char c : t) {
    if (std::isspace(static_cast<unsigned char>(c))) {
      space = true;
      continue;
    }
    if (space && !out.empty()) {
      out.push_back(' ');
    }
    space = false;
    out.push_back(c);
  }
  return out;
}

bool IsUnsupportedComplexType(const std::string& key) {
  return key.find("%ROWTYPE") != std::string::npos || key.find("%TYPE") != std::string::npos ||
         key.find("RECORD") != std::string::npos || key.find("VARRAY") != std::string::npos ||
         key.find("TABLE") != std::string::npos || key.find("OBJECT") != std::string::npos ||
         key.find("XMLTYPE") != std::string::npos || key.find("ANYDATA") != std::string::npos ||
         key.find("INTERVAL") != std::string::npos;
}

bool ClassifyType(const std::string& type, BindKind& kind, std::string& label, std::string& error) {
  const std::string key = NormalizedTypeKey(type);
  if (key.empty() || key == "UNKNOWN") {
    kind = BindKind::Varchar;
    label = "VARCHAR2";
    return true;
  }
  if (IsUnsupportedComplexType(key)) {
    error = "oracle: routine.call does not support parameter type " + key +
            " (use query script or simplify signature)";
    return false;
  }

  if (key == "NUMBER" || key == "INTEGER" || key == "INT" || key == "SMALLINT" || key == "BIGINT" ||
      key == "DECIMAL" || key == "NUMERIC" || key == "FLOAT" || key == "DOUBLE" ||
      key == "DOUBLE PRECISION" || key == "REAL" || key == "BINARY_INTEGER" || key == "PLS_INTEGER" ||
      key == "BINARY_FLOAT" || key == "BINARY_DOUBLE" || key == "NATURAL" || key == "POSITIVE" ||
      key == "SIGNTYPE") {
    kind = BindKind::Number;
    label = key;
    return true;
  }
  if (key == "DATE") {
    kind = BindKind::Date;
    label = "DATE";
    return true;
  }
  if (key == "TIMESTAMP" || key == "TIMESTAMP WITH LOCAL TIME ZONE" ||
      key.find("TIMESTAMP WITH LOCAL") == 0) {
    kind = BindKind::Timestamp;
    label = "TIMESTAMP";
    return true;
  }
  if (key == "TIMESTAMP WITH TIME ZONE" || key.find("TIMESTAMP WITH TIME") == 0) {
    kind = BindKind::TimestampTz;
    label = "TIMESTAMP WITH TIME ZONE";
    return true;
  }
  if (key == "BOOLEAN" || key == "BOOL" || key == "PL/SQL BOOLEAN") {
    kind = BindKind::Boolean;
    label = "BOOLEAN";
    return true;
  }
  if (key == "CLOB" || key == "NCLOB" || key == "LONG") {
    kind = BindKind::Clob;
    label = key == "NCLOB" ? "NCLOB" : "CLOB";
    return true;
  }
  if (key == "BLOB") {
    kind = BindKind::Blob;
    label = "BLOB";
    return true;
  }
  if (key == "RAW" || key == "LONG RAW") {
    kind = BindKind::Raw;
    label = "RAW";
    return true;
  }
  if (key == "REF CURSOR" || key == "SYS_REFCURSOR" || key == "REFCURSOR" || key == "CURSOR" ||
      key.find("REF CURSOR") != std::string::npos) {
    kind = BindKind::RefCursor;
    label = "REF CURSOR";
    return true;
  }
  // 字符类（含 ROWID 文本化）
  kind = BindKind::Varchar;
  label = key.empty() ? "VARCHAR2" : key;
  return true;
}

bool IsRefCursorType(const std::string& type) {
  BindKind k = BindKind::Varchar;
  std::string label;
  std::string err;
  return ClassifyType(type, k, label, err) && k == BindKind::RefCursor;
}

bool IsNullKeyword(const std::string& value) {
  return Upper(Trim(value)) == "NULL";
}

bool ParseNumberString(const std::string& raw) {
  if (raw.empty()) {
    return false;
  }
  size_t i = 0;
  if (raw[0] == '+' || raw[0] == '-') {
    i = 1;
  }
  if (i >= raw.size()) {
    return false;
  }
  bool digit = false;
  bool dot = false;
  bool exp = false;
  for (; i < raw.size(); ++i) {
    const char c = raw[i];
    if (c >= '0' && c <= '9') {
      digit = true;
      continue;
    }
    if (c == '.' && !dot && !exp) {
      dot = true;
      continue;
    }
    if ((c == 'e' || c == 'E') && digit && !exp) {
      exp = true;
      digit = false;
      if (i + 1 < raw.size() && (raw[i + 1] == '+' || raw[i + 1] == '-')) {
        ++i;
      }
      continue;
    }
    return false;
  }
  return digit;
}

int HexNibble(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  return -1;
}

bool ParseHex(const std::string& raw, std::string& out, std::string& error) {
  std::string hex;
  hex.reserve(raw.size());
  size_t start = 0;
  const std::string trimmed = Trim(raw);
  if (trimmed.size() >= 2 && trimmed[0] == '0' && (trimmed[1] == 'x' || trimmed[1] == 'X')) {
    start = 2;
  }
  for (size_t i = start; i < trimmed.size(); ++i) {
    const char c = trimmed[i];
    if (std::isspace(static_cast<unsigned char>(c)) || c == '-' || c == ':') {
      continue;
    }
    if (HexNibble(c) < 0) {
      error = "oracle: invalid hex for RAW/BLOB";
      return false;
    }
    hex.push_back(c);
  }
  if (hex.size() % 2 != 0) {
    error = "oracle: hex length must be even for RAW/BLOB";
    return false;
  }
  out.clear();
  out.reserve(hex.size() / 2);
  for (size_t i = 0; i + 1 < hex.size(); i += 2) {
    const int hi = HexNibble(hex[i]);
    const int lo = HexNibble(hex[i + 1]);
    out.push_back(static_cast<char>((hi << 4) | lo));
  }
  return true;
}

std::string ToHex(const std::string& raw) {
  static const char* kHex = "0123456789ABCDEF";
  std::string out;
  out.reserve(raw.size() * 2);
  for (unsigned char c : raw) {
    out.push_back(kHex[c >> 4]);
    out.push_back(kHex[c & 0x0f]);
  }
  return out;
}

struct ParsedTs {
  int16_t year = 1970;
  uint8_t month = 1;
  uint8_t day = 1;
  uint8_t hour = 0;
  uint8_t minute = 0;
  uint8_t second = 0;
  uint32_t fsecond = 0;
  int8_t tz_hour = 0;
  int8_t tz_min = 0;
  bool has_tz = false;
};

bool ParseTimestamp(const std::string& raw, bool allow_tz, ParsedTs& out, std::string& error) {
  // 接受：YYYY-MM-DD[ HH:MI:SS[.FF]][ ±HH:MI]
  //       YYYY/MM/DD …
  int y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
  char frac[16] = {0};
  char sign = 0;
  int tzh = 0, tzm = 0;
  const char* p = raw.c_str();

  int n = std::sscanf(p, "%d-%d-%d %d:%d:%d.%15[0-9]", &y, &mo, &d, &h, &mi, &s, frac);
  if (n < 3) {
    n = std::sscanf(p, "%d/%d/%d %d:%d:%d.%15[0-9]", &y, &mo, &d, &h, &mi, &s, frac);
  }
  if (n < 3) {
    n = std::sscanf(p, "%d-%d-%d", &y, &mo, &d);
    if (n < 3) {
      n = std::sscanf(p, "%d/%d/%d", &y, &mo, &d);
    }
  }
  if (n < 3 || mo < 1 || mo > 12 || d < 1 || d > 31) {
    error = "oracle: invalid date/timestamp (use YYYY-MM-DD[ HH:MI:SS[.FF]])";
    return false;
  }

  // 时区：在串尾找 ±HH:MI
  if (allow_tz) {
    const char* tz = nullptr;
    for (const char* q = raw.c_str() + raw.size(); q > raw.c_str(); --q) {
      if (*(q - 1) == '+' || *(q - 1) == '-') {
        // 排除日期里的分隔；要求后面像时区
        int th = 0, tm = 0;
        if (std::sscanf(q - 1, "%c%d:%d", &sign, &th, &tm) == 3) {
          tz = q - 1;
          tzh = th;
          tzm = tm;
          break;
        }
      }
    }
    if (tz) {
      out.has_tz = true;
      out.tz_hour = static_cast<int8_t>(sign == '-' ? -tzh : tzh);
      out.tz_min = static_cast<int8_t>(sign == '-' ? -tzm : tzm);
    }
  }

  uint32_t fs = 0;
  if (frac[0]) {
    // 补齐到纳秒（9 位）
    std::string f(frac);
    while (f.size() < 9) {
      f.push_back('0');
    }
    if (f.size() > 9) {
      f = f.substr(0, 9);
    }
    fs = static_cast<uint32_t>(std::strtoul(f.c_str(), nullptr, 10));
  }

  out.year = static_cast<int16_t>(y);
  out.month = static_cast<uint8_t>(mo);
  out.day = static_cast<uint8_t>(d);
  out.hour = static_cast<uint8_t>(h);
  out.minute = static_cast<uint8_t>(mi);
  out.second = static_cast<uint8_t>(s);
  out.fsecond = fs;
  return true;
}

bool ParseBoolean(const std::string& raw, int& out, std::string& error) {
  const std::string v = Upper(Trim(raw));
  if (v == "1" || v == "TRUE" || v == "T" || v == "YES" || v == "Y" || v == "ON") {
    out = 1;
    return true;
  }
  if (v == "0" || v == "FALSE" || v == "F" || v == "NO" || v == "N" || v == "OFF") {
    out = 0;
    return true;
  }
  error = "oracle: invalid boolean (use TRUE/FALSE or 1/0)";
  return false;
}

void SetBindNull(dpiData* data) { dpiData_setNull(data); }

bool AllocBind(dpiConn* conn, dpiContext* ctx, BindKind kind, BindSlot& slot, std::string& error) {
  dpiVar* raw_var = nullptr;
  dpiData* raw_data = nullptr;
  int rc = -1;
  switch (kind) {
    case BindKind::Number:
      // 字符串形式 NUMBER，避免 double 丢精度
      rc = dpiConn_newVar(conn, DPI_ORACLE_TYPE_NUMBER, DPI_NATIVE_TYPE_BYTES, 1, 128, 0, 0, nullptr,
                          &raw_var, &raw_data);
      break;
    case BindKind::Varchar:
      rc = dpiConn_newVar(conn, DPI_ORACLE_TYPE_VARCHAR, DPI_NATIVE_TYPE_BYTES, 1, 32767, 0, 0,
                          nullptr, &raw_var, &raw_data);
      break;
    case BindKind::Clob:
      rc = dpiConn_newVar(conn, DPI_ORACLE_TYPE_CLOB, DPI_NATIVE_TYPE_LOB, 1, 0, 0, 0, nullptr,
                          &raw_var, &raw_data);
      break;
    case BindKind::Blob:
      rc = dpiConn_newVar(conn, DPI_ORACLE_TYPE_BLOB, DPI_NATIVE_TYPE_LOB, 1, 0, 0, 0, nullptr,
                          &raw_var, &raw_data);
      break;
    case BindKind::Raw:
      rc = dpiConn_newVar(conn, DPI_ORACLE_TYPE_RAW, DPI_NATIVE_TYPE_BYTES, 1, 32767, 0, 0, nullptr,
                          &raw_var, &raw_data);
      break;
    case BindKind::Date:
      rc = dpiConn_newVar(conn, DPI_ORACLE_TYPE_DATE, DPI_NATIVE_TYPE_TIMESTAMP, 1, 0, 0, 0, nullptr,
                          &raw_var, &raw_data);
      break;
    case BindKind::Timestamp:
      rc = dpiConn_newVar(conn, DPI_ORACLE_TYPE_TIMESTAMP, DPI_NATIVE_TYPE_TIMESTAMP, 1, 0, 0, 0,
                          nullptr, &raw_var, &raw_data);
      break;
    case BindKind::TimestampTz:
      rc = dpiConn_newVar(conn, DPI_ORACLE_TYPE_TIMESTAMP_TZ, DPI_NATIVE_TYPE_TIMESTAMP, 1, 0, 0, 0,
                          nullptr, &raw_var, &raw_data);
      break;
    case BindKind::Boolean:
      rc = dpiConn_newVar(conn, DPI_ORACLE_TYPE_BOOLEAN, DPI_NATIVE_TYPE_BOOLEAN, 1, 0, 0, 0, nullptr,
                          &raw_var, &raw_data);
      break;
    case BindKind::RefCursor:
      rc = dpiConn_newVar(conn, DPI_ORACLE_TYPE_STMT, DPI_NATIVE_TYPE_STMT, 1, 0, 0, 0, nullptr,
                          &raw_var, &raw_data);
      break;
  }
  if (rc < 0) {
    error = DpiError(ctx);
    return false;
  }
  slot.var.Reset(raw_var);
  slot.data = raw_data;
  slot.kind = kind;
  return true;
}

bool ApplyInValue(dpiConn* conn, dpiContext* ctx, BindSlot& slot, const RoutineCallArg& a,
                  std::string& error) {
  const std::string trimmed = Trim(a.value);
  const bool want_null = a.is_null || IsNullKeyword(a.value);

  auto empty_as_null = [&]() -> bool {
    switch (slot.kind) {
      case BindKind::Number:
      case BindKind::Date:
      case BindKind::Timestamp:
      case BindKind::TimestampTz:
      case BindKind::Boolean:
      case BindKind::Clob:
      case BindKind::Blob:
      case BindKind::Raw:
      case BindKind::RefCursor:
        return true;
      case BindKind::Varchar:
        return false;
    }
    return true;
  };

  if (want_null || (trimmed.empty() && empty_as_null())) {
    SetBindNull(slot.data);
    return true;
  }

  switch (slot.kind) {
    case BindKind::Number: {
      if (!ParseNumberString(trimmed)) {
        error = "oracle: invalid number for parameter " + slot.column_name + ": " + trimmed;
        return false;
      }
      slot.data->isNull = 0;
      dpiData_setBytes(slot.data, const_cast<char*>(trimmed.c_str()),
                       static_cast<uint32_t>(trimmed.size()));
      return true;
    }
    case BindKind::Varchar: {
      slot.data->isNull = 0;
      dpiData_setBytes(slot.data, const_cast<char*>(trimmed.c_str()),
                       static_cast<uint32_t>(trimmed.size()));
      return true;
    }
    case BindKind::Raw: {
      std::string bytes;
      if (!ParseHex(trimmed, bytes, error)) {
        error += " (" + slot.column_name + ")";
        return false;
      }
      slot.data->isNull = 0;
      dpiData_setBytes(slot.data, bytes.empty() ? const_cast<char*>("") : bytes.data(),
                       static_cast<uint32_t>(bytes.size()));
      return true;
    }
    case BindKind::Clob:
    case BindKind::Blob: {
      dpiLob* lob = nullptr;
      const dpiOracleTypeNum lob_type =
          slot.kind == BindKind::Blob ? DPI_ORACLE_TYPE_BLOB : DPI_ORACLE_TYPE_CLOB;
      if (dpiConn_newTempLob(conn, lob_type, &lob) < 0) {
        error = DpiError(ctx);
        return false;
      }
      slot.lob.Reset(lob);
      if (slot.kind == BindKind::Blob) {
        std::string bytes;
        if (!ParseHex(trimmed, bytes, error)) {
          error += " (" + slot.column_name + ")";
          return false;
        }
        if (!bytes.empty() &&
            dpiLob_setFromBytes(lob, bytes.data(), static_cast<uint64_t>(bytes.size())) < 0) {
          error = DpiError(ctx);
          return false;
        }
      } else if (!trimmed.empty() &&
                 dpiLob_setFromBytes(lob, trimmed.c_str(), static_cast<uint64_t>(trimmed.size())) <
                     0) {
        error = DpiError(ctx);
        return false;
      }
      slot.data->isNull = 0;
      dpiData_setLOB(slot.data, lob);
      return true;
    }
    case BindKind::Date:
    case BindKind::Timestamp:
    case BindKind::TimestampTz: {
      ParsedTs ts;
      if (!ParseTimestamp(trimmed, slot.kind == BindKind::TimestampTz, ts, error)) {
        error += " (" + slot.column_name + ")";
        return false;
      }
      slot.data->isNull = 0;
      dpiData_setTimestamp(slot.data, ts.year, ts.month, ts.day, ts.hour, ts.minute, ts.second,
                           ts.fsecond, ts.tz_hour, ts.tz_min);
      return true;
    }
    case BindKind::Boolean: {
      int b = 0;
      if (!ParseBoolean(trimmed, b, error)) {
        error += " (" + slot.column_name + ")";
        return false;
      }
      slot.data->isNull = 0;
      dpiData_setBool(slot.data, b);
      return true;
    }
    case BindKind::RefCursor:
      error = "oracle: REF CURSOR cannot be used as IN value (" + slot.column_name + ")";
      return false;
  }
  error = "oracle: unsupported bind kind";
  return false;
}

nlohmann::json ReadVarAsJson(dpiContext* ctx, const BindSlot& slot) {
  dpiData* data = slot.data;
  if (data == nullptr || data->isNull) {
    return nullptr;
  }
  switch (slot.kind) {
    case BindKind::Number:
    case BindKind::Varchar: {
      if (data->value.asBytes.ptr == nullptr) {
        return "";
      }
      std::string raw(reinterpret_cast<const char*>(data->value.asBytes.ptr),
                      data->value.asBytes.length);
      return util::EnsureUtf8(raw);
    }
    case BindKind::Raw: {
      if (data->value.asBytes.ptr == nullptr) {
        return "";
      }
      std::string raw(reinterpret_cast<const char*>(data->value.asBytes.ptr),
                      data->value.asBytes.length);
      return ToHex(raw);
    }
    case BindKind::Clob:
    case BindKind::Blob: {
      util::LobReadResult lob;
      std::string err;
      if (!util::ReadLobData(ctx, DPI_NATIVE_TYPE_LOB, data, 256 * 1024, lob, err)) {
        return nlohmann::json{{"$error", err}};
      }
      if (slot.kind == BindKind::Blob) {
        std::string hex = ToHex(lob.data);
        if (lob.truncated) {
          hex += " … [LOB truncated]";
        }
        return hex;
      }
      std::string text = util::EnsureUtf8(lob.data);
      if (lob.truncated) {
        text += " … [LOB truncated]";
      }
      return text;
    }
    case BindKind::Date: {
      const auto& t = data->value.asTimestamp;
      char buf[32];
      std::snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d", t.year, t.month, t.day,
                    t.hour, t.minute, t.second);
      return std::string(buf);
    }
    case BindKind::Timestamp:
    case BindKind::TimestampTz: {
      const auto& t = data->value.asTimestamp;
      char buf[64];
      std::snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d.%09u", t.year, t.month, t.day,
                    t.hour, t.minute, t.second, t.fsecond);
      std::string s(buf);
      if (slot.kind == BindKind::TimestampTz) {
        char z[16];
        const char sign = (t.tzHourOffset < 0 || t.tzMinuteOffset < 0) ? '-' : '+';
        std::snprintf(z, sizeof(z), " %c%02d:%02d", sign, std::abs(t.tzHourOffset),
                      std::abs(t.tzMinuteOffset));
        s += z;
      }
      return s;
    }
    case BindKind::Boolean:
      return data->value.asBoolean ? "TRUE" : "FALSE";
    case BindKind::RefCursor:
      return "<REF CURSOR>";
  }
  return nullptr;
}

std::string CursorColTypeName(dpiOracleTypeNum oracle_type) {
  switch (oracle_type) {
    case DPI_ORACLE_TYPE_NUMBER:
      return "NUMBER";
    case DPI_ORACLE_TYPE_VARCHAR:
    case DPI_ORACLE_TYPE_NVARCHAR:
    case DPI_ORACLE_TYPE_CHAR:
    case DPI_ORACLE_TYPE_NCHAR:
      return "VARCHAR2";
    case DPI_ORACLE_TYPE_DATE:
      return "DATE";
    case DPI_ORACLE_TYPE_TIMESTAMP:
    case DPI_ORACLE_TYPE_TIMESTAMP_TZ:
    case DPI_ORACLE_TYPE_TIMESTAMP_LTZ:
      return "TIMESTAMP";
    case DPI_ORACLE_TYPE_CLOB:
    case DPI_ORACLE_TYPE_NCLOB:
      return "CLOB";
    case DPI_ORACLE_TYPE_BLOB:
      return "BLOB";
    case DPI_ORACLE_TYPE_RAW:
      return "RAW";
    default:
      return "OTHER";
  }
}

nlohmann::json CursorCellToJson(dpiContext* ctx, dpiOracleTypeNum oracle_type, dpiNativeTypeNum native,
                                dpiData* data) {
  if (data == nullptr || data->isNull) {
    return nullptr;
  }
  if (native == DPI_NATIVE_TYPE_LOB || oracle_type == DPI_ORACLE_TYPE_CLOB ||
      oracle_type == DPI_ORACLE_TYPE_NCLOB || oracle_type == DPI_ORACLE_TYPE_BLOB ||
      oracle_type == DPI_ORACLE_TYPE_BFILE) {
    return util::LobCellToJson(ctx, oracle_type, native, data);
  }
  switch (native) {
    case DPI_NATIVE_TYPE_INT64:
      return data->value.asInt64;
    case DPI_NATIVE_TYPE_UINT64:
      return data->value.asUint64;
    case DPI_NATIVE_TYPE_FLOAT:
      return data->value.asFloat;
    case DPI_NATIVE_TYPE_DOUBLE:
      return data->value.asDouble;
    case DPI_NATIVE_TYPE_BYTES:
      if (oracle_type == DPI_ORACLE_TYPE_RAW || oracle_type == DPI_ORACLE_TYPE_LONG_RAW) {
        const std::string raw(reinterpret_cast<const char*>(data->value.asBytes.ptr),
                              data->value.asBytes.length);
        return ToHex(raw);
      }
      return util::EnsureUtf8(std::string(reinterpret_cast<const char*>(data->value.asBytes.ptr),
                                          data->value.asBytes.length));
    case DPI_NATIVE_TYPE_BOOLEAN:
      return data->value.asBoolean ? true : false;
    case DPI_NATIVE_TYPE_TIMESTAMP: {
      const auto& t = data->value.asTimestamp;
      char buf[64];
      std::snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d", t.year, t.month, t.day, t.hour,
                    t.minute, t.second);
      return std::string(buf);
    }
    default:
      return nullptr;
  }
}

/** 从 OUT REF CURSOR 拉取结果集（对齐查询面板网格；最多 max_rows 行）。 */
bool FetchRefCursorResult(dpiContext* ctx, dpiStmt* cursor, int max_rows, nlohmann::json& columns,
                          nlohmann::json& rows, bool& truncated, std::string& error) {
  columns = nlohmann::json::array();
  rows = nlohmann::json::array();
  truncated = false;
  if (!cursor) {
    error = "oracle: REF CURSOR is null";
    return false;
  }
  uint32_t num_cols = 0;
  if (dpiStmt_getNumQueryColumns(cursor, &num_cols) < 0) {
    error = DpiError(ctx);
    return false;
  }
  if (num_cols == 0) {
    return true;
  }
  std::vector<dpiOracleTypeNum> oracle_types;
  oracle_types.reserve(num_cols);
  for (uint32_t i = 1; i <= num_cols; ++i) {
    dpiQueryInfo info{};
    if (dpiStmt_getQueryInfo(cursor, i, &info) < 0) {
      error = DpiError(ctx);
      return false;
    }
    std::string name(info.name, info.nameLength);
    columns.push_back(nlohmann::json{{"name", util::EnsureUtf8(name)},
                                     {"dataType", CursorColTypeName(info.typeInfo.oracleTypeNum)}});
    oracle_types.push_back(info.typeInfo.oracleTypeNum);
  }

  if (max_rows <= 0) {
    max_rows = 200;
  }
  while (static_cast<int>(rows.size()) < max_rows) {
    int found = 0;
    uint32_t buffer_row = 0;
    if (dpiStmt_fetch(cursor, &found, &buffer_row) < 0) {
      error = DpiError(ctx);
      return false;
    }
    if (!found) {
      break;
    }
    nlohmann::json row = nlohmann::json::array();
    for (uint32_t c = 1; c <= num_cols; ++c) {
      dpiNativeTypeNum native = DPI_NATIVE_TYPE_BYTES;
      dpiData* data = nullptr;
      if (dpiStmt_getQueryValue(cursor, c, &native, &data) < 0) {
        error = DpiError(ctx);
        return false;
      }
      row.push_back(CursorCellToJson(ctx, oracle_types[c - 1], native, data));
    }
    rows.push_back(std::move(row));
  }
  // 探测是否还有更多
  int found = 0;
  uint32_t buffer_row = 0;
  if (dpiStmt_fetch(cursor, &found, &buffer_row) == 0 && found) {
    truncated = true;
  }
  return true;
}

}  // namespace

RoutineCallParams RoutineCallParams::FromJson(const nlohmann::json& j) {
  RoutineCallParams p;
  if (j.contains("sessionId") && j["sessionId"].is_string()) {
    p.session_id = j["sessionId"].get<std::string>();
  }
  if (j.contains("schema") && j["schema"].is_string()) {
    p.schema = j["schema"].get<std::string>();
  }
  if (j.contains("name") && j["name"].is_string()) {
    p.name = j["name"].get<std::string>();
  } else if (j.contains("routine") && j["routine"].is_string()) {
    p.name = j["routine"].get<std::string>();
  }
  if (j.contains("kind") && j["kind"].is_string()) {
    p.kind = j["kind"].get<std::string>();
  }
  if (j.contains("returnType") && j["returnType"].is_string()) {
    p.return_type = j["returnType"].get<std::string>();
  }
  if (j.contains("timeoutMs") && j["timeoutMs"].is_number_integer()) {
    p.timeout_ms = j["timeoutMs"].get<int>();
  }
  if (j.contains("requestId") && j["requestId"].is_string()) {
    p.request_id = j["requestId"].get<std::string>();
  }
  if (j.contains("args") && j["args"].is_array()) {
    for (const auto& item : j["args"]) {
      if (!item.is_object()) {
        continue;
      }
      RoutineCallArg a;
      if (item.contains("name") && item["name"].is_string()) {
        a.name = item["name"].get<std::string>();
      }
      if (item.contains("type") && item["type"].is_string()) {
        a.type = item["type"].get<std::string>();
      } else if (item.contains("dataType") && item["dataType"].is_string()) {
        a.type = item["dataType"].get<std::string>();
      }
      if (item.contains("mode") && item["mode"].is_string()) {
        a.mode = item["mode"].get<std::string>();
      }
      if (item.contains("value")) {
        if (item["value"].is_string()) {
          a.value = item["value"].get<std::string>();
        } else if (!item["value"].is_null()) {
          a.value = item["value"].dump();
        }
      }
      if (item.contains("isNull") && item["isNull"].is_boolean()) {
        a.is_null = item["isNull"].get<bool>();
      }
      p.args.push_back(std::move(a));
    }
  }
  return p;
}

nlohmann::json CallRoutine(Session& session, const RoutineCallParams& params, std::string& error) {
  const auto started = std::chrono::steady_clock::now();
  error.clear();

  if (!session.conn || !session.ctx) {
    error = "oracle: session has no connection";
    return {};
  }
  if (params.schema.empty() || params.name.empty()) {
    error = "oracle: schema and name required";
    return {};
  }
  if (!util::IsSafeIdent(params.schema) || !util::IsSafeIdent(params.name)) {
    error = "oracle: invalid schema or name";
    return {};
  }

  std::string kind = params.kind;
  for (char& c : kind) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  const bool is_function = (kind == "function");

  auto* ctx = session.ctx.get();
  auto* conn = session.conn.get();
  const std::string request_id =
      params.request_id.empty() ? util::NextId("rc") : params.request_id;

  CallTimeoutScope timeout_scope(conn, params.timeout_ms);
  if (!SetCurrentSchema(ctx, conn, params.schema, error)) {
    return {};
  }

  const std::string qn = util::QuoteIdent(params.schema) + "." + util::QuoteIdent(params.name);
  std::vector<BindSlot> binds;
  binds.reserve(params.args.size() + (is_function ? 1 : 0));

  auto push_bind = [&](const std::string& type, const std::string& col, bool report_out,
                       const RoutineCallArg* in_arg) -> bool {
    BindKind bkind = BindKind::Varchar;
    std::string label;
    if (!ClassifyType(type, bkind, label, error)) {
      return false;
    }
    BindSlot slot;
    if (!AllocBind(conn, ctx, bkind, slot, error)) {
      return false;
    }
    slot.column_name = col;
    slot.data_type_label = label;
    slot.report_out = report_out;
    if (in_arg == nullptr) {
      // OUT / RETURN
      SetBindNull(slot.data);
    } else if (!ApplyInValue(conn, ctx, slot, *in_arg, error)) {
      return false;
    }
    binds.push_back(std::move(slot));
    return true;
  };

  if (is_function) {
    if (!push_bind(params.return_type.empty() ? "VARCHAR2" : params.return_type, "RETURN", true,
                   nullptr)) {
      return {};
    }
  }

  for (size_t i = 0; i < params.args.size(); ++i) {
    const auto& a = params.args[i];
    const std::string mode = NormalizeMode(a.mode);
    const bool is_out = (mode == "OUT" || mode == "INOUT");
    // INOUT + REF CURSOR：只作 OUT 绑定（空 IN）
    if (mode == "OUT" || (mode == "INOUT" && IsRefCursorType(a.type))) {
      if (!push_bind(a.type, DisplayName(a, static_cast<int>(i + 1)), true, nullptr)) {
        return {};
      }
    } else {
      if (!push_bind(a.type, DisplayName(a, static_cast<int>(i + 1)), is_out, &a)) {
        return {};
      }
    }
  }

  std::string plsql;
  if (is_function) {
    plsql = "BEGIN :1 := " + qn + "(";
    for (size_t i = 1; i < binds.size(); ++i) {
      if (i > 1) {
        plsql += ", ";
      }
      plsql += ":" + std::to_string(i + 1);
    }
    plsql += "); END;";
  } else {
    plsql = "BEGIN " + qn + "(";
    for (size_t i = 0; i < binds.size(); ++i) {
      if (i > 0) {
        plsql += ", ";
      }
      plsql += ":" + std::to_string(i + 1);
    }
    plsql += "); END;";
  }

  util::StmtGuard stmt;
  {
    dpiStmt* raw = nullptr;
    if (dpiConn_prepareStmt(conn, 0, plsql.c_str(), static_cast<uint32_t>(plsql.size()), nullptr, 0,
                            &raw) < 0) {
      error = DpiError(ctx);
      return {};
    }
    stmt.Reset(raw);
  }

  for (size_t i = 0; i < binds.size(); ++i) {
    if (dpiStmt_bindByPos(stmt.Get(), static_cast<uint32_t>(i + 1), binds[i].var.Get()) < 0) {
      error = DpiError(ctx);
      return {};
    }
  }

  {
    std::lock_guard lock(session.mu);
    session.cancel_stmt = stmt.Get();
    session.active_request_id = request_id;
  }

  uint32_t num_cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &num_cols) < 0) {
    error = DpiError(ctx);
    std::lock_guard lock(session.mu);
    session.cancel_stmt = nullptr;
    session.active_request_id.clear();
    return {};
  }

  {
    std::lock_guard lock(session.mu);
    session.cancel_stmt = nullptr;
    session.active_request_id.clear();
  }

  if (!AfterDml(session, error)) {
    return {};
  }

  nlohmann::json columns = nlohmann::json::array();
  nlohmann::json rows = nlohmann::json::array();
  std::string command_tag = "CALL";
  bool truncated = false;
  int row_count = 0;

  // 优先展示第一个 OUT REF CURSOR 结果集（对齐 Navicat 执行对话框）
  bool have_cursor = false;
  for (const auto& b : binds) {
    if (b.kind != BindKind::RefCursor || !b.report_out || b.data == nullptr || b.data->isNull) {
      continue;
    }
    dpiStmt* cursor = b.data->value.asStmt;
    if (!FetchRefCursorResult(ctx, cursor, 500, columns, rows, truncated, error)) {
      return {};
    }
    have_cursor = true;
    command_tag = "REF_CURSOR";
    row_count = static_cast<int>(rows.size());
    break;
  }

  if (!have_cursor) {
    nlohmann::json wide = nlohmann::json::array();
    for (const auto& b : binds) {
      if (!b.report_out || b.kind == BindKind::RefCursor) {
        continue;
      }
      columns.push_back(
          nlohmann::json{{"name", b.column_name}, {"dataType", b.data_type_label}});
      wide.push_back(ReadVarAsJson(ctx, b));
    }
    if (!columns.empty()) {
      rows = nlohmann::json::array({std::move(wide)});
      row_count = 1;
    }
  }

  nlohmann::json out_lines = DrainDbmsOutput(session, 200);
  const auto duration_ms =
      std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started)
          .count();

  nlohmann::json result{
      {"requestId", request_id},
      {"columns", columns},
      {"rows", rows},
      {"rowCount", row_count},
      {"fetchedCount", row_count},
      {"durationMs", duration_ms},
      {"commandTag", command_tag},
  };
  if (truncated) {
    result["truncated"] = true;
    result["hasMore"] = true;
  }
  if (out_lines.is_array() && !out_lines.empty()) {
    result["dbmsOutput"] = std::move(out_lines);
  }
  return result;
}

}  // namespace niuma::oracle::session
