#include "dataio/ops.hpp"

#include "dataio/atomic_output.hpp"
#include "dataio/script_split.hpp"
#include "meta/metadata_ddl.hpp"
#include "meta/relation.hpp"
#include "meta/routines.hpp"
#include "session/connect.hpp"
#include "session/sql_rows.hpp"
#include "util/dpi_error.hpp"
#include "util/ident.hpp"
#include "util/lob.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <iomanip>
#include <limits>
#include <new>
#include <sstream>
#include <unordered_set>
#include <vector>

namespace niuma::oracle::dataio {
namespace {

bool Canceled(const CancelFlag& cancel) { return cancel && cancel->load(); }

bool OpenIoSession(const session::ConnectParams& connect, session::Session& out, std::string& error) {
  auto opened = session::ConnectAndProbe(connect, error);
  if (!opened.conn) {
    return false;
  }
  out.conn = std::move(opened.conn);
  out.proxy_relay = std::move(opened.proxy_relay);
  out.ssh_tunnel = std::move(opened.ssh_tunnel);
  out.ctx = session::SharedContext(error);
  out.params = connect;
  out.profile = std::move(opened.profile);
  return out.conn && out.ctx;
}

bool ExecSimple(session::Session& s, const std::string& sql, std::string& error) {
  if (!s.conn || !s.ctx || sql.empty()) {
    error = "oracle: session has no connection";
    return false;
  }
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(s.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0,
                          &raw) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: exec error");
    return false;
  }
  stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: exec error");
    return false;
  }
  return true;
}

/** 配置 GET_DDL 变换，便于跨环境还原。 */
bool ConfigureMetadataTransforms(session::Session& s) {
  std::string err;
  // EMIT_SCHEMA=FALSE：对象名不加 schema，还原时靠 CURRENT_SCHEMA。
  // SEGMENT_ATTRIBUTES/STORAGE/TABLESPACE=FALSE：去掉表空间与物理属性，避免目标库
  // 无同名 tablespace 时 CREATE 失败，随后 INSERT 全员 ORA-00942。
  // REF_CONSTRAINTS=FALSE：单表/子集还原时外键常缺父表；PK/UK/CHECK 仍保留。
  // 各参数独立设置，旧版本不支持某项时不拖垮其余。
  return ExecSimple(s,
                    "BEGIN\n"
                    "  BEGIN\n"
                    "    DBMS_METADATA.SET_TRANSFORM_PARAM("
                    "DBMS_METADATA.SESSION_TRANSFORM, 'EMIT_SCHEMA', FALSE);\n"
                    "  EXCEPTION WHEN OTHERS THEN NULL;\n"
                    "  END;\n"
                    "  BEGIN\n"
                    "    DBMS_METADATA.SET_TRANSFORM_PARAM("
                    "DBMS_METADATA.SESSION_TRANSFORM, 'SEGMENT_ATTRIBUTES', FALSE);\n"
                    "  EXCEPTION WHEN OTHERS THEN NULL;\n"
                    "  END;\n"
                    "  BEGIN\n"
                    "    DBMS_METADATA.SET_TRANSFORM_PARAM("
                    "DBMS_METADATA.SESSION_TRANSFORM, 'STORAGE', FALSE);\n"
                    "  EXCEPTION WHEN OTHERS THEN NULL;\n"
                    "  END;\n"
                    "  BEGIN\n"
                    "    DBMS_METADATA.SET_TRANSFORM_PARAM("
                    "DBMS_METADATA.SESSION_TRANSFORM, 'TABLESPACE', FALSE);\n"
                    "  EXCEPTION WHEN OTHERS THEN NULL;\n"
                    "  END;\n"
                    "  BEGIN\n"
                    "    DBMS_METADATA.SET_TRANSFORM_PARAM("
                    "DBMS_METADATA.SESSION_TRANSFORM, 'REF_CONSTRAINTS', FALSE);\n"
                    "  EXCEPTION WHEN OTHERS THEN NULL;\n"
                    "  END;\n"
                    "END;",
                    err);
}

std::string Upper(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  }
  return s;
}

void EraseAll(std::string& s, const std::string& needle) {
  if (needle.empty()) {
    return;
  }
  size_t pos = 0;
  while ((pos = s.find(needle, pos)) != std::string::npos) {
    s.erase(pos, needle.size());
  }
}

bool IsIdentChar(unsigned char c) {
  return static_cast<bool>(std::isalnum(c)) || c == '_' || c == '$' || c == '#';
}

/** 去掉未加引号的 SCHEMA. 前缀（大小写不敏感，避开字符串/引号标识符内部）。 */
void EraseUnquotedSchemaDot(std::string& sql, const std::string& schema) {
  if (schema.empty()) {
    return;
  }
  const std::string want = Upper(schema);
  size_t i = 0;
  while (i < sql.size()) {
    const char ch = sql[i];
    if (ch == '\'') {
      ++i;
      while (i < sql.size()) {
        if (sql[i] == '\'') {
          if (i + 1 < sql.size() && sql[i + 1] == '\'') {
            i += 2;
            continue;
          }
          ++i;
          break;
        }
        ++i;
      }
      continue;
    }
    if (ch == '"') {
      ++i;
      while (i < sql.size()) {
        if (sql[i] == '"') {
          if (i + 1 < sql.size() && sql[i + 1] == '"') {
            i += 2;
            continue;
          }
          ++i;
          break;
        }
        ++i;
      }
      continue;
    }
    if (i + want.size() + 1 <= sql.size()) {
      bool match = true;
      for (size_t j = 0; j < want.size(); ++j) {
        if (std::toupper(static_cast<unsigned char>(sql[i + j])) !=
            static_cast<unsigned char>(want[j])) {
          match = false;
          break;
        }
      }
      if (match && sql[i + want.size()] == '.') {
        if (i == 0 || !IsIdentChar(static_cast<unsigned char>(sql[i - 1]))) {
          sql.erase(i, want.size() + 1);
          continue;
        }
      }
    }
    ++i;
  }
}

std::string TrimRight(std::string s) {
  while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' ' || s.back() == '\t')) {
    s.pop_back();
  }
  return s;
}

std::string TrimLeft(std::string s) {
  size_t i = 0;
  while (i < s.size() &&
         (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n')) {
    ++i;
  }
  return i == 0 ? s : s.substr(i);
}

/** 去掉末尾独占行的 /（GET_DDL 偶发自带；转储会再补）。保留 PL/SQL 的 END;。 */
std::string TrimTrailingSlashLines(std::string s) {
  return StripSqlPlusTerminator(std::move(s));
}

/** 非 PL/SQL：去掉末尾 ;，写文件时再统一补上。 */
std::string TrimTrailingSemicolons(std::string s) {
  s = TrimRight(std::move(s));
  while (!s.empty() && s.back() == ';') {
    s.pop_back();
    s = TrimRight(std::move(s));
  }
  return s;
}

/** ALL_SOURCE 回退文本补 CREATE OR REPLACE。
 * GET_DDL 常带前导换行/空格；必须先 TrimLeft，否则会误判并再包一层
 * `CREATE OR REPLACE FUNCTION`，执行时报 ORA-04050。 */
std::string EnsureCreateOrReplace(std::string ddl, const std::string& object_type) {
  ddl = TrimLeft(TrimRight(std::move(ddl)));
  if (ddl.empty()) return ddl;
  const size_t probe = std::min<size_t>(ddl.size(), 96);
  std::string upper = Upper(ddl.substr(0, probe));
  if (upper.rfind("CREATE", 0) == 0) {
    if (upper.rfind("CREATE OR REPLACE", 0) == 0) {
      return ddl;
    }
    // CREATE [EDITIONABLE] XXX → CREATE OR REPLACE [EDITIONABLE] XXX
    return "CREATE OR REPLACE" + ddl.substr(6);
  }
  const std::string ot = Upper(object_type);
  if (upper.rfind(ot, 0) == 0 || upper.rfind("PACKAGE", 0) == 0 ||
      upper.rfind("PROCEDURE", 0) == 0 || upper.rfind("FUNCTION", 0) == 0) {
    return "CREATE OR REPLACE " + ddl;
  }
  return "CREATE OR REPLACE " + ot + " " + ddl;
}

std::string StripSchemaQualifier(std::string sql, const std::string& schema) {
  if (schema.empty() || sql.empty()) {
    return sql;
  }
  // 引号形式："SCHEMA". / "schema".（Oracle 引号标识符大小写敏感，两种都试）
  EraseAll(sql, util::QuoteIdent(schema) + ".");
  const std::string upper = Upper(schema);
  if (upper != schema) {
    EraseAll(sql, util::QuoteIdent(upper) + ".");
  }
  // 未加引号：SCHEMA.BAS_SKU → BAS_SKU
  EraseUnquotedSchemaDot(sql, schema);
  return sql;
}

int CreateRank(const std::string& type) {
  if (type == "sequence") return 1;
  if (type == "synonym") return 2;
  if (type == "table") return 3;
  if (type == "view") return 4;
  if (type == "procedure") return 5;
  if (type == "function") return 6;
  if (type == "package") return 7;
  if (type == "trigger") return 8;
  return 9;
}

bool IsPlsqlType(const std::string& type) {
  return type == "procedure" || type == "function" || type == "package" || type == "trigger";
}

std::string DropStatement(const std::string& type, const std::string& qn) {
  if (type == "table") {
    return "DROP TABLE " + qn + " CASCADE CONSTRAINTS;\n";
  }
  if (type == "view") {
    return "DROP VIEW " + qn + ";\n";
  }
  if (type == "procedure") {
    return "DROP PROCEDURE " + qn + ";\n";
  }
  if (type == "function") {
    return "DROP FUNCTION " + qn + ";\n";
  }
  if (type == "package") {
    return "DROP PACKAGE " + qn + ";\n";
  }
  if (type == "sequence") {
    return "DROP SEQUENCE " + qn + ";\n";
  }
  if (type == "synonym") {
    return "DROP SYNONYM " + qn + ";\n";
  }
  if (type == "trigger") {
    return "DROP TRIGGER " + qn + ";\n";
  }
  return {};
}

std::string DumpObjectType(const std::string& object_type) {
  const std::string t = Upper(object_type);
  if (t == "TABLE") return "table";
  if (t == "VIEW") return "view";
  if (t == "PROCEDURE") return "procedure";
  if (t == "FUNCTION") return "function";
  if (t == "PACKAGE" || t == "PACKAGE BODY") return "package";
  if (t == "SEQUENCE") return "sequence";
  if (t == "SYNONYM") return "synonym";
  if (t == "TRIGGER") return "trigger";
  return {};
}

struct DumpObject {
  std::string name;
  std::string type;  // table | view | procedure | function | package | sequence | synonym | trigger
  bool has_package_body = false;
};

bool NameAllowed(const std::string& obj_type, const std::string& name,
                 const std::unordered_set<std::string>& want, bool tables_views_only) {
  if (want.empty()) {
    return true;
  }
  if (tables_views_only && obj_type != "table" && obj_type != "view") {
    return true;
  }
  if (want.count(name) || want.count(Upper(name))) {
    return true;
  }
  return false;
}

bool GetMetadataDdl(session::Session& session, const std::string& object_type,
                    const std::string& schema, const std::string& name, std::string& ddl,
                    std::string& error) {
  std::string raw;
  if (!meta::FetchDbmsMetadataDdl(session, object_type, schema, name, raw, error)) {
    if (!error.empty()) {
      error += " for " + object_type + " " + schema + "." + name;
    }
    return false;
  }
  ddl = TrimTrailingSlashLines(std::move(raw));
  return true;
}

bool LoadObjectBlocks(session::Session& s, const std::string& schema, const std::string& name,
                      const std::string& oracle_type, bool has_package_body,
                      std::vector<std::string>& blocks, std::string& error) {
  blocks.clear();
  const std::string t = Upper(oracle_type);
  // 表/视图：走 meta.GetDDL（GET_DDL 失败时视图降级 ALL_VIEWS、表降级列重建）。
  if (t == "TABLE" || t == "VIEW") {
    meta::RelationRef ref;
    ref.schema = schema;
    ref.name = name;
    ref.object_type = t == "VIEW" ? "view" : "table";
    const auto j = meta::GetDDL(s, ref, error);
    if (!error.empty() || !j.contains("ddl") || !j["ddl"].is_string()) {
      if (error.empty()) {
        error = "oracle: no DDL generated for " + t + " " + schema + "." + name;
      }
      return false;
    }
    blocks.push_back(TrimTrailingSemicolons(j["ddl"].get<std::string>()));
    return true;
  }
  if (t == "SEQUENCE" || t == "SYNONYM") {
    std::string ddl;
    if (!GetMetadataDdl(s, t, schema, name, ddl, error)) return false;
    blocks.push_back(TrimTrailingSemicolons(std::move(ddl)));
    return true;
  }
  if (t == "TRIGGER") {
    std::string ddl;
    if (!GetMetadataDdl(s, "TRIGGER", schema, name, ddl, error)) return false;
    blocks.push_back(EnsureCreateOrReplace(std::move(ddl), "TRIGGER"));
    return true;
  }
  // 过程/函数：与编辑源码一致——GET_DDL 失败则拼 ALL_SOURCE（避免仅 GET_DDL 路径硬失败）。
  if (t == "PROCEDURE" || t == "FUNCTION") {
    meta::RoutineRef ref;
    ref.schema = schema;
    ref.name = name;
    ref.kind = t == "FUNCTION" ? "function" : "procedure";
    const auto j = meta::GetRoutineSource(s, ref, error);
    if (!error.empty() || !j.contains("definition") || !j["definition"].is_string()) {
      if (error.empty()) {
        error = "oracle: no DDL generated for " + t + " " + schema + "." + name;
      }
      return false;
    }
    blocks.push_back(EnsureCreateOrReplace(j["definition"].get<std::string>(), t));
    return true;
  }
  // 包：GET_DDL 失败则 ALL_SOURCE（包头/包体）。
  if (t == "PACKAGE") {
    meta::PackageRef ref;
    ref.schema = schema;
    ref.name = name;
    ref.part = "both";
    const auto j = meta::GetPackageSource(s, ref, error);
    if (!error.empty()) {
      return false;
    }
    if (j.contains("definition") && j["definition"].is_string()) {
      blocks.push_back(EnsureCreateOrReplace(j["definition"].get<std::string>(), "PACKAGE"));
    }
    if (j.contains("bodyDefinition") && j["bodyDefinition"].is_string()) {
      blocks.push_back(EnsureCreateOrReplace(j["bodyDefinition"].get<std::string>(), "PACKAGE BODY"));
    } else if (has_package_body) {
      error = "oracle: package body not found: " + schema + "." + name;
      return false;
    }
    if (blocks.empty()) {
      error = "oracle: no DDL generated for PACKAGE " + schema + "." + name;
      return false;
    }
    return true;
  }
  error = "oracle: unsupported dump object type: " + oracle_type;
  return false;
}

bool ResolveDumpObjects(session::Session& s, const DumpParams& dump, std::vector<DumpObject>& out,
                        std::string& error) {
  out.clear();
  std::unordered_set<std::string> want;
  for (const auto& t : dump.tables) {
    if (!t.empty()) {
      want.insert(t);
      want.insert(Upper(t));
    }
  }
  const bool tables_views_only =
      !want.empty() && (dump.include_tables || dump.include_views);

  std::vector<std::string> type_specs;
  if (dump.include_tables) type_specs.push_back("TABLE");
  if (dump.include_views) type_specs.push_back("VIEW");
  if (dump.include_procedures) type_specs.push_back("PROCEDURE");
  if (dump.include_functions) type_specs.push_back("FUNCTION");
  if (dump.include_packages) {
    type_specs.push_back("PACKAGE");
    type_specs.push_back("PACKAGE BODY");
  }
  if (dump.include_sequences) type_specs.push_back("SEQUENCE");
  if (dump.include_synonyms) type_specs.push_back("SYNONYM");
  if (dump.include_triggers) type_specs.push_back("TRIGGER");
  if (type_specs.empty()) {
    return true;
  }

  std::ostringstream in_list;
  for (size_t i = 0; i < type_specs.size(); ++i) {
    if (i) in_list << ", ";
    in_list << util::QuoteLiteral(type_specs[i]);
  }
  const std::string sql =
      "SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OWNER = " +
      util::QuoteLiteral(dump.schema) + " AND OBJECT_TYPE IN (" + in_list.str() +
      ") ORDER BY OBJECT_NAME";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(s, sql, 20001, rows, error)) {
    return false;
  }
  if (rows.truncated) {
    error = "oracle: object list exceeds 20000 entries; narrow the dump selection";
    return false;
  }

  for (const auto& row : rows.rows) {
    if (row.size() < 2) {
      error = "oracle: object list query returned an incomplete row";
      return false;
    }
    const std::string& name = row[0];
    const std::string& otype = row[1];
    const std::string obj_type = DumpObjectType(otype);
    if (obj_type.empty()) {
      error = "oracle: unsupported object type in dump list: " + otype;
      return false;
    }
    if (!util::IsSafeIdent(name)) {
      error = "oracle: unsafe object name in dump list";
      return false;
    }
    if (!NameAllowed(obj_type, name, want, tables_views_only)) {
      continue;
    }

    if (obj_type == "package") {
      const std::string key = Upper(name);
      auto existing = std::find_if(out.begin(), out.end(), [&](const DumpObject& object) {
        return object.type == "package" && Upper(object.name) == key;
      });
      if (existing != out.end()) {
        if (Upper(otype) == "PACKAGE BODY") existing->has_package_body = true;
        continue;
      }
      out.push_back(DumpObject{name, obj_type, Upper(otype) == "PACKAGE BODY"});
      continue;
    }
    out.push_back(DumpObject{name, obj_type, false});
  }
  return true;
}

struct DumpColumn {
  std::string name;
  dpiOracleTypeNum oracle_type = DPI_ORACLE_TYPE_NONE;
};

std::string OracleTypeName(dpiOracleTypeNum type) {
  switch (type) {
    case DPI_ORACLE_TYPE_VARCHAR: return "VARCHAR2";
    case DPI_ORACLE_TYPE_NVARCHAR: return "NVARCHAR2";
    case DPI_ORACLE_TYPE_CHAR: return "CHAR";
    case DPI_ORACLE_TYPE_NCHAR: return "NCHAR";
    case DPI_ORACLE_TYPE_NUMBER: return "NUMBER";
    case DPI_ORACLE_TYPE_DATE: return "DATE";
    case DPI_ORACLE_TYPE_TIMESTAMP: return "TIMESTAMP";
    case DPI_ORACLE_TYPE_TIMESTAMP_TZ: return "TIMESTAMP WITH TIME ZONE";
    case DPI_ORACLE_TYPE_TIMESTAMP_LTZ: return "TIMESTAMP WITH LOCAL TIME ZONE";
    case DPI_ORACLE_TYPE_RAW: return "RAW";
    case DPI_ORACLE_TYPE_CLOB: return "CLOB";
    case DPI_ORACLE_TYPE_NCLOB: return "NCLOB";
    case DPI_ORACLE_TYPE_BLOB: return "BLOB";
    default: return "ODPI type " + std::to_string(type);
  }
}

bool IsSupportedDumpType(dpiOracleTypeNum type) {
  switch (type) {
    case DPI_ORACLE_TYPE_VARCHAR:
    case DPI_ORACLE_TYPE_NVARCHAR:
    case DPI_ORACLE_TYPE_CHAR:
    case DPI_ORACLE_TYPE_NCHAR:
    case DPI_ORACLE_TYPE_NUMBER:
    case DPI_ORACLE_TYPE_DATE:
    case DPI_ORACLE_TYPE_TIMESTAMP:
    case DPI_ORACLE_TYPE_TIMESTAMP_TZ:
    case DPI_ORACLE_TYPE_TIMESTAMP_LTZ:
    case DPI_ORACLE_TYPE_RAW:
    case DPI_ORACLE_TYPE_CLOB:
    case DPI_ORACLE_TYPE_NCLOB:
    case DPI_ORACLE_TYPE_BLOB:
      return true;
    default:
      return false;
  }
}

std::string Hex(const std::string& value) {
  static constexpr char digits[] = "0123456789ABCDEF";
  std::string out;
  out.reserve(value.size() * 2);
  for (unsigned char c : value) {
    out.push_back(digits[c >> 4]);
    out.push_back(digits[c & 0x0f]);
  }
  return out;
}

bool IsNumberLiteral(const std::string& value) {
  size_t i = 0;
  if (i < value.size() && (value[i] == '+' || value[i] == '-')) ++i;
  bool digits = false;
  while (i < value.size() && std::isdigit(static_cast<unsigned char>(value[i]))) {
    digits = true;
    ++i;
  }
  if (i < value.size() && value[i] == '.') {
    ++i;
    while (i < value.size() && std::isdigit(static_cast<unsigned char>(value[i]))) {
      digits = true;
      ++i;
    }
  }
  if (!digits) return false;
  if (i < value.size() && (value[i] == 'e' || value[i] == 'E')) {
    ++i;
    if (i < value.size() && (value[i] == '+' || value[i] == '-')) ++i;
    const size_t exponent_start = i;
    while (i < value.size() && std::isdigit(static_cast<unsigned char>(value[i]))) ++i;
    if (i == exponent_start) return false;
  }
  return i == value.size();
}

std::vector<std::string> ByteChunks(const std::string& value, size_t max_bytes) {
  std::vector<std::string> chunks;
  size_t offset = 0;
  while (offset < value.size()) {
    size_t end = std::min(value.size(), offset + max_bytes);
    while (end > offset && end < value.size() &&
           (static_cast<unsigned char>(value[end]) & 0xc0) == 0x80) {
      --end;
    }
    if (end == offset) end = std::min(value.size(), offset + max_bytes);
    chunks.push_back(value.substr(offset, end - offset));
    offset = end;
  }
  return chunks;
}

bool LobLiteral(const std::string& value, dpiOracleTypeNum type, std::string& literal,
                std::string& error) {
  if (type == DPI_ORACLE_TYPE_BLOB) {
    if (value.empty()) {
      literal = "EMPTY_BLOB()";
      return true;
    }
    const auto chunks = ByteChunks(value, 1000);
    std::ostringstream sql;
    for (size_t i = 0; i < chunks.size(); ++i) {
      if (i) sql << " || ";
      sql << "TO_BLOB(HEXTORAW('" << Hex(chunks[i]) << "'))";
    }
    literal = sql.str();
    return true;
  }
  if (value.find('\0') != std::string::npos) {
    error = "oracle: CLOB containing NUL cannot be represented as replayable SQL";
    return false;
  }
  if (value.empty()) {
    literal = type == DPI_ORACLE_TYPE_NCLOB ? "TO_NCLOB('')" : "EMPTY_CLOB()";
    return true;
  }
  const auto chunks = ByteChunks(value, 1000);
  std::ostringstream sql;
  const char* convert = type == DPI_ORACLE_TYPE_NCLOB ? "TO_NCLOB" : "TO_CLOB";
  for (size_t i = 0; i < chunks.size(); ++i) {
    if (i) sql << " || ";
    sql << convert << "(" << util::QuoteLiteral(chunks[i]) << ")";
  }
  literal = sql.str();
  return true;
}

std::string TimestampLiteral(const dpiTimestamp& value, dpiOracleTypeNum type) {
  char timestamp[96];
  if (type == DPI_ORACLE_TYPE_DATE) {
    std::snprintf(timestamp, sizeof(timestamp), "%04d-%02d-%02d %02d:%02d:%02d", value.year,
                  value.month, value.day, value.hour, value.minute, value.second);
    return "TO_DATE('" + std::string(timestamp) + "', 'YYYY-MM-DD HH24:MI:SS')";
  }
  std::snprintf(timestamp, sizeof(timestamp), "%04d-%02d-%02d %02d:%02d:%02d.%09u", value.year,
                value.month, value.day, value.hour, value.minute, value.second, value.fsecond);
  if (type == DPI_ORACLE_TYPE_TIMESTAMP_TZ) {
    const char sign = value.tzHourOffset < 0 || value.tzMinuteOffset < 0 ? '-' : '+';
    char zone[16];
    std::snprintf(zone, sizeof(zone), " %c%02d:%02d", sign, std::abs(value.tzHourOffset),
                  std::abs(value.tzMinuteOffset));
    return "TO_TIMESTAMP_TZ('" + std::string(timestamp) + zone +
           "', 'YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM')";
  }
  return "TO_TIMESTAMP('" + std::string(timestamp) + "', 'YYYY-MM-DD HH24:MI:SS.FF9')";
}

bool DataLiteral(session::Session& session, const DumpColumn& column, dpiNativeTypeNum native,
                 dpiData* data,
                 std::string& literal, std::string& error) {
  if (!data) {
    error = "oracle: missing data value for column " + column.name;
    return false;
  }
  if (data->isNull) {
    literal = "NULL";
    return true;
  }
  const auto type = column.oracle_type;
  if (type == DPI_ORACLE_TYPE_CLOB || type == DPI_ORACLE_TYPE_NCLOB ||
      type == DPI_ORACLE_TYPE_BLOB) {
    std::string lob;
    if (!util::ReadCompleteLob(session.conn.get(), session.ctx.get(), type, native, data,
                               std::numeric_limits<uint64_t>::max(), lob, error)) {
      error += " for column " + column.name;
      return false;
    }
    return LobLiteral(lob, type, literal, error);
  }
  if (type == DPI_ORACLE_TYPE_DATE || type == DPI_ORACLE_TYPE_TIMESTAMP ||
      type == DPI_ORACLE_TYPE_TIMESTAMP_TZ || type == DPI_ORACLE_TYPE_TIMESTAMP_LTZ) {
    if (native != DPI_NATIVE_TYPE_TIMESTAMP) {
      error = "oracle: unexpected native timestamp type for column " + column.name;
      return false;
    }
    literal = TimestampLiteral(data->value.asTimestamp, type);
    return true;
  }
  if (native != DPI_NATIVE_TYPE_BYTES) {
    error = "oracle: unexpected native value type for column " + column.name;
    return false;
  }
  const std::string bytes(reinterpret_cast<const char*>(data->value.asBytes.ptr),
                          data->value.asBytes.length);
  if (type == DPI_ORACLE_TYPE_NUMBER) {
    if (!IsNumberLiteral(bytes)) {
      error = "oracle: invalid NUMBER text for column " + column.name;
      return false;
    }
    literal = bytes;
  } else if (type == DPI_ORACLE_TYPE_RAW) {
    literal = "HEXTORAW('" + Hex(bytes) + "')";
  } else {
    if (bytes.find('\0') != std::string::npos) {
      error = "oracle: text containing NUL cannot be represented for column " + column.name;
      return false;
    }
    literal = util::QuoteLiteral(bytes);
  }
  return true;
}

bool WriteInsertData(session::Session& s, std::ofstream& out, const std::string& schema,
                     const std::string& table, const CancelFlag& cancel, int64_t& bytes,
                     ProgressFn progress, int64_t object_i, std::string& error) {
  const std::string dest = util::QuoteIdent(table);
  const std::string sql =
      "SELECT * FROM " + util::QuoteIdent(schema) + "." + util::QuoteIdent(table);
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(s.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0,
                          &raw) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: failed to prepare table data query");
    return false;
  }
  stmt.Reset(raw);
  uint32_t num_cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &num_cols) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: failed to execute table data query");
    return false;
  }
  std::vector<DumpColumn> columns;
  columns.reserve(num_cols);
  for (uint32_t i = 1; i <= num_cols; ++i) {
    dpiQueryInfo info{};
    if (dpiStmt_getQueryInfo(stmt.Get(), i, &info) < 0) {
      error = util::FormatDpiError(s.ctx.get(), "oracle: failed to read table column metadata");
      return false;
    }
    DumpColumn column{std::string(info.name, info.nameLength), info.typeInfo.oracleTypeNum};
    if (!IsSupportedDumpType(column.oracle_type)) {
      error = "oracle: unsupported dump type " + OracleTypeName(column.oracle_type) +
              " for " + schema + "." + table + "." + column.name;
      return false;
    }
    if (column.oracle_type == DPI_ORACLE_TYPE_NUMBER &&
        dpiStmt_defineValue(stmt.Get(), i, DPI_ORACLE_TYPE_NUMBER, DPI_NATIVE_TYPE_BYTES, 256, 1,
                            nullptr) < 0) {
      error = util::FormatDpiError(s.ctx.get(), "oracle: failed to define NUMBER fetch type");
      return false;
    }
    if ((column.oracle_type == DPI_ORACLE_TYPE_CLOB || column.oracle_type == DPI_ORACLE_TYPE_NCLOB ||
         column.oracle_type == DPI_ORACLE_TYPE_BLOB) &&
        dpiStmt_defineValue(stmt.Get(), i, column.oracle_type, DPI_NATIVE_TYPE_LOB, 0, 0,
                            nullptr) < 0) {
      error = util::FormatDpiError(s.ctx.get(), "oracle: failed to define LOB fetch type");
      return false;
    }
    columns.push_back(std::move(column));
  }
  int64_t row_count = 0;
  while (true) {
    if (Canceled(cancel)) {
      error = "canceled";
      return false;
    }
    int found = 0;
    uint32_t br = 0;
    if (dpiStmt_fetch(stmt.Get(), &found, &br) < 0) {
      error = util::FormatDpiError(s.ctx.get(), "oracle: failed to fetch table data");
      return false;
    }
    if (!found) {
      break;
    }
    out << "INSERT INTO " << dest << " (";
    for (size_t i = 0; i < columns.size(); ++i) {
      if (i) out << ", ";
      out << util::QuoteIdent(columns[i].name);
    }
    out << ") VALUES (";
    for (uint32_t c = 1; c <= num_cols; ++c) {
      if (c > 1) out << ", ";
      dpiNativeTypeNum native = DPI_NATIVE_TYPE_BYTES;
      dpiData* data = nullptr;
      if (dpiStmt_getQueryValue(stmt.Get(), c, &native, &data) < 0) {
        error = util::FormatDpiError(s.ctx.get(), "oracle: failed to read table data value");
        return false;
      }
      std::string literal;
      if (!DataLiteral(s, columns[c - 1], native, data, literal, error)) return false;
      out << literal;
    }
    out << ");\n";
    if (!out) {
      error = "oracle: failed to write dump file";
      return false;
    }
    ++row_count;
    // 大表降低事件频率（manager 另有 200ms 节流）；约每 5000 行一条。
    if (progress && row_count % 5000 == 0) {
      bytes = static_cast<int64_t>(out.tellp());
      progress(bytes, object_i,
               "dumped " + table + " data (" + std::to_string(row_count) + " rows)");
    }
  }
  out << "\n";
  if (progress) {
    bytes = static_cast<int64_t>(out.tellp());
    progress(bytes, object_i,
             "dumped " + table + " data (" + std::to_string(row_count) + " rows)");
  }
  return true;
}

std::string IsoNowUtc() {
  using clock = std::chrono::system_clock;
  const auto now = clock::now();
  const std::time_t tt = clock::to_time_t(now);
  std::tm tm{};
#ifdef _WIN32
  gmtime_s(&tm, &tt);
#else
  gmtime_r(&tt, &tm);
#endif
  char buf[32];
  std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
  return buf;
}

}  // namespace

bool RunDumpSql(const session::ConnectParams& connect, const DumpParams& dump, CancelFlag cancel,
                ProgressFn progress, std::string& error) {
  if (!util::IsSafeIdent(dump.schema)) {
    error = "oracle: invalid schema";
    return false;
  }
  if (dump.output_path.empty()) {
    error = "oracle: outputPath required";
    return false;
  }
  const std::string mode = dump.mode.empty() ? "structure_and_data" : dump.mode;
  if (mode != "structure_and_data" && mode != "structure_only" && mode != "data_only") {
    error = "oracle: invalid dump mode: " + dump.mode;
    return false;
  }

  session::Session s;
  if (!OpenIoSession(connect, s, error)) {
    return false;
  }
  IoCancelRegistration cancel_registration(cancel, s.conn.get());
  // 尽力配置可移植 DDL；失败时仍靠 StripSchemaQualifier 兜底。
  (void)ConfigureMetadataTransforms(s);
  if (progress) {
    progress(0, 0, "resolving objects in " + dump.schema);
  }

  std::vector<DumpObject> objects;
  if (!ResolveDumpObjects(s, dump, objects, error)) {
    return false;
  }
  if (objects.empty()) {
    error = "oracle: no objects to dump";
    return false;
  }
  if (progress) {
    progress(0, static_cast<int64_t>(objects.size()),
             "resolving " + std::to_string(objects.size()) + " object(s)");
  }

  std::sort(objects.begin(), objects.end(), [](const DumpObject& a, const DumpObject& b) {
    const int ra = CreateRank(a.type);
    const int rb = CreateRank(b.type);
    if (ra != rb) return ra < rb;
    return a.name < b.name;
  });

  AtomicOutput atomic_output(dump.output_path);
  if (!atomic_output.Open(error)) return false;
  std::ofstream& out = atomic_output.stream();

  const bool want_struct = mode == "structure_and_data" || mode == "structure_only";
  const bool want_data = mode == "structure_and_data" || mode == "data_only";

  out << "-- NiuMa Oracle dump\n"
      << "-- format: niuma-oracle-dump/1\n"
      << "-- schema: " << dump.schema << "\n"
      << "-- generated: " << IsoNowUtc() << "\n"
      << "-- mode: " << mode << "\n"
      << "-- dropIfExists: " << (dump.drop_if_exists ? "true" : "false") << "\n"
      << "-- truncateBeforeData: " << (dump.truncate_before_data ? "true" : "false") << "\n"
      << "-- note: object names are unqualified so restore can target another schema via "
         "CURRENT_SCHEMA\n"
      << "-- note: physical attributes (tablespace/storage) are omitted for portable restore\n"
      << "-- note: PL/SQL units (procedure/function/package) are terminated with a lone /\n\n";

  int64_t bytes = 0;
  if (want_struct && dump.drop_if_exists) {
    out << "-- Drops (dependency-safe order)\n";
    for (int i = static_cast<int>(objects.size()) - 1; i >= 0; --i) {
      const auto& obj = objects[static_cast<size_t>(i)];
      const std::string drop = DropStatement(obj.type, util::QuoteIdent(obj.name));
      if (!drop.empty()) {
        out << drop;
      }
    }
    out << "\n";
  }

  const int total = static_cast<int>(objects.size());
  for (int i = 0; i < total; ++i) {
    if (Canceled(cancel)) {
      error = "canceled";
      return false;
    }
    const auto& obj = objects[static_cast<size_t>(i)];
    if (progress) {
      bytes = static_cast<int64_t>(out.tellp());
      progress(bytes, i + 1, "dumping " + obj.name + " (" + std::to_string(i + 1) + "/" +
                                 std::to_string(total) + ")");
    }

    if (want_struct) {
      std::vector<std::string> blocks;
      const std::string oracle_type = Upper(obj.type);
      if (!LoadObjectBlocks(s, dump.schema, obj.name, oracle_type, obj.has_package_body, blocks,
                            error)) {
        return false;
      }
      if (blocks.empty()) {
        error = "oracle: no DDL generated for " + dump.schema + "." + obj.name;
        return false;
      }
      for (size_t bi = 0; bi < blocks.size(); ++bi) {
        std::string ddl = StripSchemaQualifier(std::move(blocks[bi]), dump.schema);
        if (IsPlsqlType(obj.type)) {
          ddl = TrimTrailingSlashLines(std::move(ddl));
        } else {
          ddl = TrimTrailingSemicolons(TrimTrailingSlashLines(std::move(ddl)));
        }
        if (ddl.empty()) {
          error = "oracle: empty normalized DDL for " + dump.schema + "." + obj.name;
          return false;
        }
        std::string label = obj.name;
        if (blocks.size() > 1) {
          label += "#" + std::to_string(bi + 1);
        }
        out << "-- Object: " << label << " (" << obj.type << ")\n";
        if (IsPlsqlType(obj.type)) {
          out << ddl << "\n/\n\n";
        } else {
          out << ddl << ";\n\n";
        }
      }
      blocks.clear();
      blocks.shrink_to_fit();
    }

    if (want_data && obj.type == "table") {
      if (dump.truncate_before_data) {
        out << "TRUNCATE TABLE " << util::QuoteIdent(obj.name) << ";\n";
      }
      if (!WriteInsertData(s, out, dump.schema, obj.name, cancel, bytes, progress, i + 1, error)) {
        return false;
      }
    }
    if (!out) {
      error = "oracle: failed to write dump file";
      return false;
    }
  }

  const auto final_position = out.tellp();
  if (final_position < 0) {
    error = "oracle: failed to determine dump file size";
    return false;
  }
  if (!atomic_output.Commit(error)) return false;
  if (progress) {
    progress(static_cast<int64_t>(final_position), total,
             "dumped " + std::to_string(total) + " object(s)");
  }
  s.Close();
  return true;
}

}  // namespace niuma::oracle::dataio
