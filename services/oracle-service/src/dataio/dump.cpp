#include "dataio/ops.hpp"

#include "meta/relation.hpp"
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

std::vector<std::string> ListTables(session::Session& s, const std::string& schema,
                                    const std::vector<std::string>& filter, std::string& error) {
  std::vector<std::string> out;
  if (!filter.empty()) {
    return filter;
  }
  const std::string sql = "SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = " +
                          util::QuoteLiteral(schema) + " ORDER BY TABLE_NAME";
  session::SqlRowsResult rows;
  if (!session::ExecStringRows(s, sql, 5001, rows, error)) {
    return out;
  }
  for (const auto& r : rows.rows) {
    if (!r.empty()) {
      out.push_back(r[0]);
    }
  }
  return out;
}

}  // namespace

bool RunDumpSql(const session::ConnectParams& connect, const DumpParams& dump, CancelFlag cancel,
                ProgressFn progress, std::string& error) {
  if (!util::IsSafeIdent(dump.schema)) {
    error = "oracle: invalid schema";
    return false;
  }
  session::Session s;
  if (!OpenIoSession(connect, s, error)) {
    return false;
  }
  auto tables = ListTables(s, dump.schema, dump.tables, error);
  if (!error.empty()) {
    return false;
  }

  std::ofstream out(dump.output_path, std::ios::binary);
  if (!out) {
    error = "oracle: cannot create dump file";
    return false;
  }
  out << "-- NiuMa Oracle dump\n-- schema: " << dump.schema << "\n\n";

  int64_t bytes = 0;
  int64_t table_i = 0;
  const bool want_struct =
      dump.mode == "structure_and_data" || dump.mode == "structure_only" || dump.mode.empty();
  const bool want_data = dump.mode == "structure_and_data" || dump.mode == "data_only";

  for (const auto& table : tables) {
    if (Canceled(cancel)) {
      error = "canceled";
      return false;
    }
    if (!util::IsSafeIdent(table)) {
      continue;
    }
    ++table_i;
    out << "-- table " << dump.schema << "." << table << "\n";

    if (dump.drop_if_exists && want_struct) {
      out << "DROP TABLE " << util::QuoteIdent(dump.schema) << "." << util::QuoteIdent(table)
          << " CASCADE CONSTRAINTS;\n\n";
    }

    if (want_struct) {
      std::string err;
      auto ddl = meta::GetDDL(s, meta::RelationRef{dump.schema, table}, err);
      if (err.empty() && ddl.contains("ddl")) {
        out << ddl["ddl"].get<std::string>() << "\n/\n\n";
      }
    }

    if (want_data) {
      if (dump.truncate_before_data) {
        out << "TRUNCATE TABLE " << util::QuoteIdent(dump.schema) << "." << util::QuoteIdent(table)
            << ";\n";
      }
      const std::string sql =
          "SELECT * FROM " + util::QuoteIdent(dump.schema) + "." + util::QuoteIdent(table);
      util::StmtGuard stmt;
      dpiStmt* raw = nullptr;
      if (dpiConn_prepareStmt(s.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr,
                              0, &raw) < 0) {
        continue;
      }
      stmt.Reset(raw);
      uint32_t num_cols = 0;
      if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &num_cols) < 0) {
        continue;
      }
      std::vector<std::string> names;
      for (uint32_t i = 1; i <= num_cols; ++i) {
        dpiQueryInfo info{};
        dpiStmt_getQueryInfo(stmt.Get(), i, &info);
        names.emplace_back(info.name, info.nameLength);
      }
      int64_t row_count = 0;
      while (true) {
        if (Canceled(cancel)) {
          error = "canceled";
          return false;
        }
        int found = 0;
        uint32_t br = 0;
        if (dpiStmt_fetch(stmt.Get(), &found, &br) < 0 || !found) {
          break;
        }
        out << "INSERT INTO " << util::QuoteIdent(dump.schema) << "." << util::QuoteIdent(table)
            << " (";
        for (size_t i = 0; i < names.size(); ++i) {
          if (i) {
            out << ", ";
          }
          out << util::QuoteIdent(names[i]);
        }
        out << ") VALUES (";
        for (uint32_t c = 1; c <= num_cols; ++c) {
          if (c > 1) {
            out << ", ";
          }
          dpiNativeTypeNum native = DPI_NATIVE_TYPE_BYTES;
          dpiData* data = nullptr;
          if (dpiStmt_getQueryValue(stmt.Get(), c, &native, &data) < 0 || !data || data->isNull) {
            out << "NULL";
          } else if (native == DPI_NATIVE_TYPE_BYTES) {
            std::string cell(reinterpret_cast<const char*>(data->value.asBytes.ptr),
                             data->value.asBytes.length);
            out << util::QuoteLiteral(cell);
          } else if (native == DPI_NATIVE_TYPE_INT64) {
            out << data->value.asInt64;
          } else if (native == DPI_NATIVE_TYPE_DOUBLE) {
            out << data->value.asDouble;
          } else {
            out << "NULL";
          }
        }
        out << ");\n";
        ++row_count;
      }
      out << "\n";
      if (progress) {
        bytes = static_cast<int64_t>(out.tellp());
        progress(bytes, table_i, "dumped " + table + " (" + std::to_string(row_count) + " rows)");
      }
    } else if (progress) {
      bytes = static_cast<int64_t>(out.tellp());
      progress(bytes, table_i, "dumped " + table);
    }
  }

  out.flush();
  if (progress) {
    progress(static_cast<int64_t>(out.tellp()), table_i,
             "dumped " + std::to_string(table_i) + " tables");
  }
  s.Close();
  return true;
}

}  // namespace niuma::oracle::dataio
