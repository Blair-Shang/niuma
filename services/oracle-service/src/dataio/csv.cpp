#include "dataio/ops.hpp"

#include "session/connect.hpp"
#include "session/manager.hpp"
#include "session/sql_rows.hpp"
#include "util/ident.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

#include <fstream>
#include <sstream>

namespace niuma::oracle::dataio {
namespace {

bool Canceled(const CancelFlag& cancel) { return cancel && cancel->load(); }

std::string CsvEscape(const std::string& s, char delim) {
  bool need_quote = s.find(delim) != std::string::npos || s.find('"') != std::string::npos ||
                    s.find('\n') != std::string::npos || s.find('\r') != std::string::npos;
  if (!need_quote) {
    return s;
  }
  std::string out;
  out.push_back('"');
  for (char c : s) {
    if (c == '"') {
      out.push_back('"');
      out.push_back('"');
    } else {
      out.push_back(c);
    }
  }
  out.push_back('"');
  return out;
}

std::vector<std::string> SplitCsvLine(const std::string& line, char delim) {
  std::vector<std::string> cells;
  std::string cur;
  bool in_quotes = false;
  for (size_t i = 0; i < line.size(); ++i) {
    const char c = line[i];
    if (c == '"') {
      if (in_quotes && i + 1 < line.size() && line[i + 1] == '"') {
        cur.push_back('"');
        ++i;
      } else {
        in_quotes = !in_quotes;
      }
    } else if (c == delim && !in_quotes) {
      cells.push_back(cur);
      cur.clear();
    } else {
      cur.push_back(c);
    }
  }
  cells.push_back(cur);
  return cells;
}

bool OpenIoSession(const session::ConnectParams& connect, session::Session& out, std::string& error) {
  auto opened = session::ConnectAndProbe(connect, error);
  if (!opened.conn) {
    return false;
  }
  out.conn = std::move(opened.conn);
  out.ctx = session::SharedContext(error);
  out.params = connect;
  out.profile = std::move(opened.profile);
  return out.conn && out.ctx;
}

bool ExecSimple(session::Session& s, const std::string& sql, std::string& error) {
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(s.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0,
                          &raw) < 0) {
    dpiErrorInfo info{};
    dpiContext_getError(s.ctx.get(), &info);
    error = info.message ? std::string("oracle: ") + info.message : "oracle: exec failed";
    return false;
  }
  stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    dpiErrorInfo info{};
    dpiContext_getError(s.ctx.get(), &info);
    error = info.message ? std::string("oracle: ") + info.message : "oracle: exec failed";
    return false;
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
  if (!OpenIoSession(connect, s, error)) {
    return false;
  }
  const std::string sql =
      "SELECT * FROM " + util::QuoteIdent(schema) + "." + util::QuoteIdent(table);
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(s.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0,
                          &raw) < 0) {
    error = "oracle: export prepare failed";
    return false;
  }
  stmt.Reset(raw);
  uint32_t num_cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &num_cols) < 0) {
    error = "oracle: export execute failed";
    return false;
  }

  std::ofstream out(output_path, std::ios::binary);
  if (!out) {
    error = "oracle: cannot create csv file";
    return false;
  }
  // UTF-8 BOM
  out.put(static_cast<char>(0xEF));
  out.put(static_cast<char>(0xBB));
  out.put(static_cast<char>(0xBF));
  const char delim = opts.delimiter.empty() ? ',' : opts.delimiter[0];

  std::vector<std::string> names;
  names.reserve(num_cols);
  for (uint32_t i = 1; i <= num_cols; ++i) {
    dpiQueryInfo info{};
    dpiStmt_getQueryInfo(stmt.Get(), i, &info);
    names.emplace_back(info.name, info.nameLength);
  }
  if (opts.header) {
    for (size_t i = 0; i < names.size(); ++i) {
      if (i) {
        out.put(delim);
      }
      out << CsvEscape(names[i], delim);
    }
    out.put('\n');
  }

  int64_t rows = 0;
  int64_t bytes = 3;
  while (true) {
    if (Canceled(cancel)) {
      error = "canceled";
      return false;
    }
    int found = 0;
    uint32_t buffer_row = 0;
    if (dpiStmt_fetch(stmt.Get(), &found, &buffer_row) < 0) {
      error = "oracle: export fetch failed";
      return false;
    }
    if (!found) {
      break;
    }
    for (uint32_t c = 1; c <= num_cols; ++c) {
      if (c > 1) {
        out.put(delim);
      }
      dpiNativeTypeNum native = DPI_NATIVE_TYPE_BYTES;
      dpiData* data = nullptr;
      if (dpiStmt_getQueryValue(stmt.Get(), c, &native, &data) < 0 || data == nullptr || data->isNull) {
        out << opts.null_string;
      } else if (native == DPI_NATIVE_TYPE_BYTES) {
        std::string cell(reinterpret_cast<const char*>(data->value.asBytes.ptr),
                         data->value.asBytes.length);
        out << CsvEscape(cell, delim);
      } else if (native == DPI_NATIVE_TYPE_INT64) {
        out << data->value.asInt64;
      } else if (native == DPI_NATIVE_TYPE_DOUBLE) {
        out << data->value.asDouble;
      } else {
        out << opts.null_string;
      }
    }
    out.put('\n');
    ++rows;
    if (rows % 500 == 0 && progress) {
      bytes = static_cast<int64_t>(out.tellp());
      progress(bytes, rows, "exported " + std::to_string(rows) + " rows");
    }
  }
  out.flush();
  bytes = static_cast<int64_t>(out.tellp());
  if (progress) {
    progress(bytes, rows, "exported " + std::to_string(rows) + " rows total");
  }
  s.Close();
  return true;
}

bool RunImportCsv(const session::ConnectParams& connect, const std::string& schema,
                  const std::string& table, const std::string& input_path, const CsvOptions& opts,
                  CancelFlag cancel, ProgressFn progress, std::string& error) {
  if (!util::IsSafeIdent(schema) || !util::IsSafeIdent(table)) {
    error = "oracle: invalid schema/table";
    return false;
  }
  session::Session s;
  if (!OpenIoSession(connect, s, error)) {
    return false;
  }
  if (opts.truncate) {
    const std::string trunc =
        "TRUNCATE TABLE " + util::QuoteIdent(schema) + "." + util::QuoteIdent(table);
    if (!ExecSimple(s, trunc, error)) {
      return false;
    }
  }

  std::ifstream in(input_path, std::ios::binary);
  if (!in) {
    error = "oracle: cannot open csv file";
    return false;
  }
  // skip BOM
  char bom[3]{};
  in.read(bom, 3);
  if (!(bom[0] == static_cast<char>(0xEF) && bom[1] == static_cast<char>(0xBB) &&
        bom[2] == static_cast<char>(0xBF))) {
    in.clear();
    in.seekg(0);
  }

  const char delim = opts.delimiter.empty() ? ',' : opts.delimiter[0];
  std::string line;
  std::vector<std::string> headers;
  if (opts.header) {
    if (!std::getline(in, line)) {
      error = "oracle: empty csv";
      return false;
    }
    if (!line.empty() && line.back() == '\r') {
      line.pop_back();
    }
    headers = SplitCsvLine(line, delim);
  } else {
    // discover columns
    session::SqlRowsResult cols;
    const std::string q =
        "SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = " + util::QuoteLiteral(schema) +
        " AND TABLE_NAME = " + util::QuoteLiteral(table) + " ORDER BY COLUMN_ID";
    if (!session::ExecStringRows(s, q, 1001, cols, error)) {
      return false;
    }
    for (const auto& r : cols.rows) {
      if (!r.empty()) {
        headers.push_back(r[0]);
      }
    }
  }
  if (headers.empty()) {
    error = "oracle: no columns for import";
    return false;
  }

  int64_t rows = 0;
  int64_t bytes = 0;
  while (std::getline(in, line)) {
    if (Canceled(cancel)) {
      error = "canceled";
      return false;
    }
    if (!line.empty() && line.back() == '\r') {
      line.pop_back();
    }
    if (line.empty()) {
      continue;
    }
    bytes += static_cast<int64_t>(line.size());
    auto cells = SplitCsvLine(line, delim);
    std::ostringstream sql;
    sql << "INSERT INTO " << util::QuoteIdent(schema) << "." << util::QuoteIdent(table) << " (";
    for (size_t i = 0; i < headers.size(); ++i) {
      if (i) {
        sql << ", ";
      }
      sql << util::QuoteIdent(headers[i]);
    }
    sql << ") VALUES (";
    for (size_t i = 0; i < headers.size(); ++i) {
      if (i) {
        sql << ", ";
      }
      const std::string cell = i < cells.size() ? cells[i] : "";
      if (cell == opts.null_string) {
        sql << "NULL";
      } else {
        sql << util::QuoteLiteral(cell);
      }
    }
    sql << ")";
    if (!ExecSimple(s, sql.str(), error)) {
      return false;
    }
    ++rows;
    if (rows % 200 == 0 && progress) {
      progress(bytes, rows, "imported " + std::to_string(rows) + " rows");
    }
  }
  // commit if autocommit path — ODPI default may need commit
  dpiConn_commit(s.conn.get());
  if (progress) {
    progress(bytes, rows, "imported " + std::to_string(rows) + " rows total");
  }
  s.Close();
  return true;
}

}  // namespace niuma::oracle::dataio
