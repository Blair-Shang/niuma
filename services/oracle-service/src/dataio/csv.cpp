#include "dataio/ops.hpp"

#include "dataio/atomic_output.hpp"
#include "dataio/csv_codec.hpp"
#include "session/connect.hpp"
#include "session/manager.hpp"
#include "session/sql_rows.hpp"
#include "util/dpi_error.hpp"
#include "util/ident.hpp"
#include "util/lob.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <sstream>
#include <unordered_map>

namespace niuma::oracle::dataio {
namespace {

bool Canceled(const CancelFlag& cancel) { return cancel && cancel->load(); }

bool OpenIoSession(const session::ConnectParams& connect, session::Session& out,
                   std::string& error) {
  auto opened = session::ConnectAndProbe(connect, error);
  if (!opened.conn) return false;
  out.conn = std::move(opened.conn);
  out.proxy_relay = std::move(opened.proxy_relay);
  out.ssh_tunnel = std::move(opened.ssh_tunnel);
  out.ctx = session::SharedContext(error);
  out.params = connect;
  out.profile = std::move(opened.profile);
  return out.conn && out.ctx;
}

bool ExecSimple(session::Session& s, const std::string& sql, std::string& error) {
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(s.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr,
                          0, &raw) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: exec failed");
    return false;
  }
  stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: exec failed");
    return false;
  }
  return true;
}

void Rollback(session::Session& s) {
  if (s.conn) (void)dpiConn_rollback(s.conn.get());
}

std::string Upper(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
    return static_cast<char>(std::toupper(c));
  });
  return value;
}

std::string TrimAscii(std::string value) {
  size_t start = 0;
  while (start < value.size() &&
         std::isspace(static_cast<unsigned char>(value[start]))) {
    ++start;
  }
  size_t end = value.size();
  while (end > start && std::isspace(static_cast<unsigned char>(value[end - 1]))) {
    --end;
  }
  if (start == 0 && end == value.size()) return value;
  return value.substr(start, end - start);
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

bool IsNumericDataType(const std::string& type) {
  if (type == "NUMBER" || type == "FLOAT" || type == "BINARY_FLOAT" ||
      type == "BINARY_DOUBLE") {
    return true;
  }
  return type.rfind("NUMBER(", 0) == 0 || type.rfind("FLOAT(", 0) == 0;
}

std::string Hex(const std::string& raw) {
  static constexpr char kDigits[] = "0123456789ABCDEF";
  std::string out;
  out.reserve(raw.size() * 2);
  for (const unsigned char c : raw) {
    out.push_back(kDigits[c >> 4]);
    out.push_back(kDigits[c & 0x0F]);
  }
  return out;
}

bool Unhex(std::string value, std::string& raw) {
  if (value.rfind("0x", 0) == 0 || value.rfind("0X", 0) == 0) value.erase(0, 2);
  if (value.size() % 2 != 0) return false;
  raw.clear();
  raw.reserve(value.size() / 2);
  auto nibble = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  for (size_t i = 0; i < value.size(); i += 2) {
    const int hi = nibble(value[i]);
    const int lo = nibble(value[i + 1]);
    if (hi < 0 || lo < 0) return false;
    raw.push_back(static_cast<char>((hi << 4) | lo));
  }
  return true;
}

std::string CsvEscape(const std::string& value, char delimiter) {
  const bool quote = value.find(delimiter) != std::string::npos ||
                     value.find('"') != std::string::npos ||
                     value.find('\n') != std::string::npos ||
                     value.find('\r') != std::string::npos;
  if (!quote) return value;
  std::string out{"\""};
  out.reserve(value.size() + 2);
  for (char c : value) {
    if (c == '"') out.push_back('"');
    out.push_back(c);
  }
  out.push_back('"');
  return out;
}

std::string TimestampText(const dpiTimestamp& value, bool with_zone) {
  char buffer[96];
  const int fraction = static_cast<int>(value.fsecond);
  if (with_zone) {
    std::snprintf(buffer, sizeof(buffer), "%04d-%02d-%02d %02d:%02d:%02d.%09d %+03d:%02d",
                  value.year, value.month, value.day, value.hour, value.minute, value.second,
                  fraction, value.tzHourOffset, std::abs(value.tzMinuteOffset));
  } else {
    std::snprintf(buffer, sizeof(buffer), "%04d-%02d-%02d %02d:%02d:%02d.%09d", value.year,
                  value.month, value.day, value.hour, value.minute, value.second, fraction);
  }
  return buffer;
}

bool IsLobOracleType(dpiOracleTypeNum oracle_type) {
  return oracle_type == DPI_ORACLE_TYPE_CLOB || oracle_type == DPI_ORACLE_TYPE_NCLOB ||
         oracle_type == DPI_ORACLE_TYPE_BLOB;
}

bool CellText(dpiConn* conn, dpiContext* ctx, dpiOracleTypeNum oracle_type, dpiNativeTypeNum native,
              dpiData* data, const std::string& null_string, std::string& out, std::string& error) {
  if (!data || data->isNull) {
    out = null_string;
    return true;
  }
  if (native == DPI_NATIVE_TYPE_LOB || IsLobOracleType(oracle_type)) {
    const auto lob_type =
        IsLobOracleType(oracle_type) ? oracle_type : DPI_ORACLE_TYPE_CLOB;
    std::string lob;
    if (!util::ReadCompleteLob(conn, ctx, lob_type, native, data, util::kLobFullMax, lob, error)) {
      if (error == "oracle: LOB exceeds supported size") {
        error = "oracle: LOB exceeds 4MB export limit";
      }
      return false;
    }
    out = lob_type == DPI_ORACLE_TYPE_BLOB ? "0x" + Hex(lob) : std::move(lob);
    return true;
  }
  switch (native) {
    case DPI_NATIVE_TYPE_BYTES: {
      std::string bytes(reinterpret_cast<const char*>(data->value.asBytes.ptr),
                        data->value.asBytes.length);
      if (oracle_type == DPI_ORACLE_TYPE_NUMBER) {
        bytes = TrimAscii(std::move(bytes));
      }
      out = oracle_type == DPI_ORACLE_TYPE_RAW || oracle_type == DPI_ORACLE_TYPE_LONG_RAW
                ? "0x" + Hex(bytes)
                : bytes;
      return true;
    }
    case DPI_NATIVE_TYPE_INT64:
      out = std::to_string(data->value.asInt64);
      return true;
    case DPI_NATIVE_TYPE_UINT64:
      out = std::to_string(data->value.asUint64);
      return true;
    case DPI_NATIVE_TYPE_FLOAT:
    case DPI_NATIVE_TYPE_DOUBLE: {
      std::ostringstream ss;
      ss << std::setprecision(17)
         << (native == DPI_NATIVE_TYPE_FLOAT ? data->value.asFloat : data->value.asDouble);
      out = ss.str();
      return true;
    }
    case DPI_NATIVE_TYPE_TIMESTAMP:
      if (oracle_type == DPI_ORACLE_TYPE_DATE) {
        const auto& timestamp = data->value.asTimestamp;
        char buffer[32];
        std::snprintf(buffer, sizeof(buffer), "%04d-%02d-%02d %02d:%02d:%02d",
                      timestamp.year, timestamp.month, timestamp.day, timestamp.hour,
                      timestamp.minute, timestamp.second);
        out = buffer;
      } else {
        out = TimestampText(data->value.asTimestamp,
                            oracle_type == DPI_ORACLE_TYPE_TIMESTAMP_TZ);
      }
      return true;
    case DPI_NATIVE_TYPE_BOOLEAN:
      out = data->value.asBoolean ? "1" : "0";
      return true;
    default:
      error = "oracle: unsupported CSV column type";
      return false;
  }
}

struct ColumnMeta {
  std::string name;
  std::string type;
};

bool LoadColumns(session::Session& s, const std::string& schema, const std::string& table,
                 std::vector<ColumnMeta>& columns, std::string& error) {
  const std::string sql =
      "SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS WHERE OWNER = " +
      util::QuoteLiteral(schema) + " AND TABLE_NAME = " + util::QuoteLiteral(table) +
      " ORDER BY COLUMN_ID";
  session::SqlRowsResult rows;
  if (!session::ExecStringRows(s, sql, 1001, rows, error)) return false;
  if (rows.truncated) {
    error = "oracle: table has too many columns";
    return false;
  }
  for (const auto& row : rows.rows) {
    if (row.size() >= 2) columns.push_back({row[0], Upper(TrimAscii(row[1]))});
  }
  if (columns.empty()) {
    error = "oracle: no columns for import";
    return false;
  }
  return true;
}

std::vector<std::string> ColumnNames(const std::vector<ColumnMeta>& columns) {
  std::vector<std::string> names;
  names.reserve(columns.size());
  for (const auto& column : columns) names.push_back(column.name);
  return names;
}

std::unordered_map<std::string, std::string> ColumnTypes(const std::vector<ColumnMeta>& columns) {
  std::unordered_map<std::string, std::string> result;
  for (const auto& column : columns) result[Upper(column.name)] = column.type;
  return result;
}

std::string ClobLiteral(const std::string& value) {
  if (value.empty()) return "EMPTY_CLOB()";
  std::ostringstream out;
  for (size_t offset = 0; offset < value.size();) {
    size_t count = std::min<size_t>(3000, value.size() - offset);
    while (count > 0 && offset + count < value.size() &&
           (static_cast<unsigned char>(value[offset + count]) & 0xC0) == 0x80) {
      --count;
    }
    if (offset > 0) out << " || ";
    out << "TO_CLOB(" << util::QuoteLiteral(value.substr(offset, count)) << ")";
    offset += count;
  }
  return out.str();
}

bool ImportLiteral(const std::string& value, const std::string& type,
                   const std::string& null_string, std::string& out, std::string& error) {
  const std::string trimmed = TrimAscii(value);
  if (trimmed == null_string || (null_string.empty() && trimmed.empty())) {
    out = "NULL";
    return true;
  }
  if (type == "DATE") {
    out = "TO_DATE(" + util::QuoteLiteral(trimmed) + ", 'YYYY-MM-DD HH24:MI:SS')";
  } else if (type.find("TIMESTAMP") == 0 && type.find("TIME ZONE") != std::string::npos) {
    out = "TO_TIMESTAMP_TZ(" + util::QuoteLiteral(trimmed) +
          ", 'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM')";
  } else if (type.find("TIMESTAMP") == 0) {
    out = "TO_TIMESTAMP(" + util::QuoteLiteral(trimmed) + ", 'YYYY-MM-DD HH24:MI:SS.FF')";
  } else if (type == "RAW" || type == "LONG RAW" || type == "BLOB") {
    std::string raw;
    if (!Unhex(trimmed, raw)) {
      error = "oracle: invalid hexadecimal value for " + type;
      return false;
    }
    const std::string hex = Hex(raw);
    if (type == "BLOB" && raw.size() > 2000) {
      error = "oracle: BLOB CSV import exceeds 2000 bytes; use SQL dump restore";
      return false;
    }
    out = type == "BLOB" ? "TO_BLOB(HEXTORAW('" + hex + "'))" : "HEXTORAW('" + hex + "')";
  } else if (type == "CLOB" || type == "NCLOB") {
    out = ClobLiteral(trimmed);
  } else if (IsNumericDataType(type)) {
    if (!IsNumberLiteral(trimmed)) {
      error = "oracle: invalid numeric value for " + type;
      return false;
    }
    out = trimmed;
  } else if (type == "BOOLEAN") {
    if (trimmed == "1" || trimmed == "true" || trimmed == "TRUE") {
      out = "TRUE";
    } else if (trimmed == "0" || trimmed == "false" || trimmed == "FALSE") {
      out = "FALSE";
    } else {
      error = "oracle: invalid boolean value";
      return false;
    }
  } else {
    out = util::QuoteLiteral(trimmed);
  }
  return true;
}

}  // namespace

bool RunExportCsv(const session::ConnectParams& connect, const std::string& schema,
                  const std::string& table, const std::string& output_path, const CsvOptions& opts,
                  CancelFlag cancel, ProgressFn progress, std::string& error) {
  if (!util::IsSafeIdent(schema) || !util::IsSafeIdent(table)) {
    error = "oracle: invalid schema/table";
    return false;
  }
  session::Session s;
  if (!OpenIoSession(connect, s, error)) return false;
  IoCancelRegistration cancel_registration(cancel, s.conn.get());
  const std::string sql =
      "SELECT * FROM " + util::QuoteIdent(schema) + "." + util::QuoteIdent(table);
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(s.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr,
                          0, &raw) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: export prepare failed");
    return false;
  }
  stmt.Reset(raw);
  uint32_t num_cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &num_cols) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: export execute failed");
    return false;
  }
  std::vector<std::string> names;
  std::vector<dpiOracleTypeNum> oracle_types;
  for (uint32_t i = 1; i <= num_cols; ++i) {
    dpiQueryInfo info{};
    if (dpiStmt_getQueryInfo(stmt.Get(), i, &info) < 0) {
      error = util::FormatDpiError(s.ctx.get(), "oracle: export column metadata failed");
      return false;
    }
    names.emplace_back(info.name, info.nameLength);
    oracle_types.push_back(info.typeInfo.oracleTypeNum);
    if (IsLobOracleType(info.typeInfo.oracleTypeNum) &&
        dpiStmt_defineValue(stmt.Get(), i, info.typeInfo.oracleTypeNum, DPI_NATIVE_TYPE_LOB, 0, 0,
                            nullptr) < 0) {
      error = util::FormatDpiError(s.ctx.get(), "oracle: export LOB column define failed");
      return false;
    }
  }
  AtomicOutput atomic(output_path);
  if (!atomic.Open(error)) return false;
  auto& out = atomic.stream();
  out.write("\xEF\xBB\xBF", 3);
  const char delimiter = opts.delimiter.empty() ? ',' : opts.delimiter.front();
  if (opts.header) {
    for (size_t i = 0; i < names.size(); ++i) {
      if (i) out.put(delimiter);
      out << CsvEscape(names[i], delimiter);
    }
    out.put('\n');
  }
  int64_t rows = 0;
  while (true) {
    if (Canceled(cancel)) {
      error = "canceled";
      return false;
    }
    int found = 0;
    uint32_t buffer_row = 0;
    if (dpiStmt_fetch(stmt.Get(), &found, &buffer_row) < 0) {
      error = util::FormatDpiError(s.ctx.get(), "oracle: export fetch failed");
      return false;
    }
    if (!found) break;
    for (uint32_t c = 1; c <= num_cols; ++c) {
      if (c > 1) out.put(delimiter);
      dpiNativeTypeNum native = DPI_NATIVE_TYPE_BYTES;
      dpiData* data = nullptr;
      if (dpiStmt_getQueryValue(stmt.Get(), c, &native, &data) < 0) {
        error = util::FormatDpiError(s.ctx.get(), "oracle: export value failed");
        return false;
      }
      std::string value;
      if (!CellText(s.conn.get(), s.ctx.get(), oracle_types[c - 1], native, data, opts.null_string,
                    value, error)) {
        return false;
      }
      out << CsvEscape(value, delimiter);
    }
    out.put('\n');
    ++rows;
    if (rows % 500 == 0 && progress) {
      progress(static_cast<int64_t>(out.tellp()), rows,
               "exported " + std::to_string(rows) + " rows");
    }
  }
  const int64_t bytes = static_cast<int64_t>(out.tellp());
  if (!atomic.Commit(error)) return false;
  if (progress) progress(bytes, rows, "exported " + std::to_string(rows) + " rows total");
  return true;
}

bool RunImportCsv(const session::ConnectParams& connect, const std::string& schema,
                  const std::string& table, const std::string& input_path, const CsvOptions& opts,
                  CancelFlag cancel, ProgressFn progress, std::string& error) {
  if (!util::IsSafeIdent(schema) || !util::IsSafeIdent(table)) {
    error = "oracle: invalid schema/table";
    return false;
  }
  std::ifstream input(std::filesystem::u8path(input_path), std::ios::binary);
  if (!input) {
    error = "oracle: cannot open csv file";
    return false;
  }
  session::Session s;
  if (!OpenIoSession(connect, s, error)) return false;
  IoCancelRegistration cancel_registration(cancel, s.conn.get());
  std::vector<ColumnMeta> metadata;
  if (!LoadColumns(s, schema, table, metadata, error)) return false;
  CsvRecordReader reader(input, opts.delimiter.empty() ? ',' : opts.delimiter.front());
  std::vector<std::string> first;
  std::vector<std::string> source_columns;
  if (opts.header) {
    if (!reader.Read(source_columns, error)) {
      if (error.empty()) error = "oracle: empty csv";
      return false;
    }
  } else {
    source_columns = ColumnNames(metadata);
  }
  CsvProjection projection;
  if (!BuildCsvProjection(source_columns, opts.column_map, ColumnNames(metadata), projection,
                          error)) {
    return false;
  }
  const auto types = ColumnTypes(metadata);
  bool has_first = reader.Read(first, error);
  if (!has_first && !error.empty()) return false;
  if (has_first && first.size() != source_columns.size()) {
    error = "oracle: csv column count mismatch in first record";
    return false;
  }

  if (opts.truncate) {
    const std::string clear =
        "DELETE FROM " + util::QuoteIdent(schema) + "." + util::QuoteIdent(table);
    if (!ExecSimple(s, clear, error)) return false;
  }

  const std::string destination =
      util::QuoteIdent(schema) + "." + util::QuoteIdent(table);
  auto append_row = [&](const std::vector<std::string>& record, std::ostringstream& batch) -> bool {
    if (record.size() != source_columns.size()) {
      error = "oracle: csv column count mismatch";
      return false;
    }
    batch << "INTO " << destination << " (";
    for (size_t i = 0; i < projection.target_columns.size(); ++i) {
      if (i) batch << ", ";
      batch << util::QuoteIdent(projection.target_columns[i]);
    }
    batch << ") VALUES (";
    for (size_t i = 0; i < projection.target_columns.size(); ++i) {
      if (i) batch << ", ";
      const std::string& target = projection.target_columns[i];
      std::string literal;
      const auto type = types.find(Upper(target));
      if (type == types.end() ||
          !ImportLiteral(record[projection.source_indexes[i]], type->second, opts.null_string,
                         literal, error)) {
        if (error.empty()) error = "oracle: missing target column metadata";
        return false;
      }
      batch << literal;
    }
    batch << ") ";
    return true;
  };
  auto execute_batch = [&](std::ostringstream& batch, int count) -> bool {
    if (count == 0) return true;
    batch << "SELECT 1 FROM DUAL";
    if (!ExecSimple(s, batch.str(), error)) return false;
    batch.str({});
    batch.clear();
    batch << "INSERT ALL ";
    return true;
  };

  std::ostringstream batch;
  batch << "INSERT ALL ";
  int batch_rows = 0;
  int64_t rows = 0;
  auto consume = [&](const std::vector<std::string>& record) -> bool {
    if (!append_row(record, batch)) return false;
    ++batch_rows;
    ++rows;
    if (batch_rows >= 50 || batch.tellp() >= 512 * 1024) {
      if (!execute_batch(batch, batch_rows)) return false;
      batch_rows = 0;
    }
    return true;
  };
  if (has_first && !consume(first)) {
    Rollback(s);
    return false;
  }
  std::vector<std::string> record;
  while (reader.Read(record, error)) {
    if (Canceled(cancel)) {
      error = "canceled";
      Rollback(s);
      return false;
    }
    if (!consume(record)) {
      Rollback(s);
      return false;
    }
    if (rows % 200 == 0 && progress) {
      progress(reader.bytes_read(), rows, "imported " + std::to_string(rows) + " rows");
    }
  }
  if (!error.empty() || !execute_batch(batch, batch_rows)) {
    Rollback(s);
    return false;
  }
  if (Canceled(cancel)) {
    error = "canceled";
    Rollback(s);
    return false;
  }
  if (dpiConn_commit(s.conn.get()) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: import commit failed");
    Rollback(s);
    return false;
  }
  if (progress) {
    progress(reader.bytes_read(), rows, "imported " + std::to_string(rows) + " rows total");
  }
  return true;
}

}  // namespace niuma::oracle::dataio
