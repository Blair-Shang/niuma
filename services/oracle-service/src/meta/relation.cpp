#include "meta/relation.hpp"

#include "session/sql_rows.hpp"
#include "util/ident.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

#include <cctype>
#include <sstream>

namespace niuma::oracle::meta {
namespace {

std::string DpiError(dpiContext* ctx) {
  dpiErrorInfo info{};
  if (ctx) {
    dpiContext_getError(ctx, &info);
  }
  if (info.message == nullptr) {
    return "oracle: meta error";
  }
  return std::string("oracle: ") + info.message;
}

bool RequireRelation(const RelationRef& ref, std::string& error) {
  if (ref.schema.empty() || !util::IsSafeIdent(ref.schema)) {
    error = "oracle: schema required";
    return false;
  }
  if (ref.name.empty() || !util::IsSafeIdent(ref.name)) {
    error = "oracle: table/name required";
    return false;
  }
  return true;
}

std::string ReadLobOrBytes(dpiContext* ctx, dpiNativeTypeNum native, dpiData* data, std::string& error) {
  if (data == nullptr || data->isNull) {
    return {};
  }
  if (native == DPI_NATIVE_TYPE_BYTES) {
    return std::string(reinterpret_cast<const char*>(data->value.asBytes.ptr), data->value.asBytes.length);
  }
  if (native == DPI_NATIVE_TYPE_LOB) {
    dpiLob* lob = data->value.asLOB;
    uint64_t size = 0;
    if (dpiLob_getSize(lob, &size) < 0) {
      error = DpiError(ctx);
      return {};
    }
    // 防护：过大 DDL 截断到 4MiB
    constexpr uint64_t kMax = 4ull * 1024 * 1024;
    const uint64_t to_read = size > kMax ? kMax : size;
    std::string out;
    out.resize(static_cast<size_t>(to_read));
    uint64_t amount = to_read;
    if (dpiLob_readBytes(lob, 1, to_read, out.data(), &amount) < 0) {
      error = DpiError(ctx);
      return {};
    }
    out.resize(static_cast<size_t>(amount));
    return out;
  }
  return {};
}

std::string DetectObjectType(session::Session& session, const RelationRef& ref) {
  const std::string sql =
      "SELECT OBJECT_TYPE FROM ALL_OBJECTS WHERE OWNER = " + util::QuoteLiteral(ref.schema) +
      " AND OBJECT_NAME = " + util::QuoteLiteral(ref.name) +
      " AND OBJECT_TYPE IN ('TABLE','VIEW') ORDER BY CASE OBJECT_TYPE WHEN 'TABLE' THEN 1 ELSE 2 END "
      "FETCH FIRST 1 ROWS ONLY";
  session::SqlRowsResult rows;
  std::string err;
  if (!session::ExecStringRows(session, sql, 2, rows, err) || rows.rows.empty() || rows.rows[0].empty()) {
    return "TABLE";
  }
  return rows.rows[0][0];
}

nlohmann::json RebuildTableDDL(session::Session& session, const RelationRef& ref, std::string& error) {
  auto cols = ListColumns(session, ref, error);
  if (!error.empty()) {
    return {};
  }
  std::ostringstream oss;
  oss << "CREATE TABLE " << util::QuoteIdent(ref.schema) << "." << util::QuoteIdent(ref.name) << " (\n";
  const auto& arr = cols["columns"];
  for (size_t i = 0; i < arr.size(); ++i) {
    const auto& c = arr[i];
    oss << "  " << util::QuoteIdent(c.value("name", "")) << " " << c.value("dataType", "VARCHAR2");
    if (!c.value("nullable", true)) {
      oss << " NOT NULL";
    }
    if (c.contains("default") && !c["default"].is_null()) {
      oss << " DEFAULT " << c["default"].get<std::string>();
    }
    if (i + 1 < arr.size()) {
      oss << ",";
    }
    oss << "\n";
  }
  oss << ");\n";
  return nlohmann::json{{"objectType", "table"}, {"ddl", oss.str()}};
}

}  // namespace

RelationRef RelationRef::FromJson(const nlohmann::json& j) {
  RelationRef r;
  if (j.contains("schema") && j["schema"].is_string()) {
    r.schema = j["schema"].get<std::string>();
  } else if (j.contains("database") && j["database"].is_string()) {
    r.schema = j["database"].get<std::string>();
  }
  if (j.contains("table") && j["table"].is_string()) {
    r.name = j["table"].get<std::string>();
  } else if (j.contains("name") && j["name"].is_string()) {
    r.name = j["name"].get<std::string>();
  }
  return r;
}

nlohmann::json ListColumns(session::Session& session, const RelationRef& ref, std::string& error) {
  if (!RequireRelation(ref, error)) {
    return {};
  }
  const std::string sql =
      "SELECT c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE, c.DATA_DEFAULT, c.COLUMN_ID, "
      "COALESCE(cm.COMMENTS, '') "
      "FROM ALL_TAB_COLUMNS c "
      "LEFT JOIN ALL_COL_COMMENTS cm ON cm.OWNER = c.OWNER AND cm.TABLE_NAME = c.TABLE_NAME "
      "AND cm.COLUMN_NAME = c.COLUMN_NAME "
      "WHERE c.OWNER = " +
      util::QuoteLiteral(ref.schema) + " AND c.TABLE_NAME = " + util::QuoteLiteral(ref.name) +
      " ORDER BY c.COLUMN_ID";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, 5001, rows, error)) {
    return {};
  }
  nlohmann::json columns = nlohmann::json::array();
  for (const auto& row : rows.rows) {
    if (row.size() < 5) {
      continue;
    }
    nlohmann::json col{
        {"name", row[0]},
        {"dataType", row[1]},
        {"nullable", row[2] == "Y" || row[2] == "y"},
        {"ordinal", 0},
    };
    try {
      col["ordinal"] = std::stoi(row[4]);
    } catch (...) {
      col["ordinal"] = static_cast<int>(columns.size() + 1);
    }
    if (row.size() > 3 && !row[3].empty()) {
      col["default"] = row[3];
    }
    if (row.size() > 5 && !row[5].empty()) {
      col["comment"] = row[5];
    }
    columns.push_back(std::move(col));
  }
  return nlohmann::json{{"columns", columns}};
}

nlohmann::json ListIndexes(session::Session& session, const RelationRef& ref, std::string& error) {
  if (!RequireRelation(ref, error)) {
    return {};
  }
  const std::string sql =
      "SELECT i.INDEX_NAME, i.UNIQUENESS, c.COLUMN_NAME "
      "FROM ALL_INDEXES i "
      "JOIN ALL_IND_COLUMNS c ON c.INDEX_OWNER = i.OWNER AND c.INDEX_NAME = i.INDEX_NAME "
      "WHERE i.TABLE_OWNER = " +
      util::QuoteLiteral(ref.schema) + " AND i.TABLE_NAME = " + util::QuoteLiteral(ref.name) +
      " ORDER BY i.INDEX_NAME, c.COLUMN_POSITION";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, 5001, rows, error)) {
    return {};
  }

  nlohmann::json indexes = nlohmann::json::array();
  nlohmann::json* current = nullptr;
  std::string current_name;
  for (const auto& row : rows.rows) {
    if (row.size() < 3) {
      continue;
    }
    if (row[0] != current_name) {
      indexes.push_back(nlohmann::json{
          {"name", row[0]},
          {"unique", row[1] == "UNIQUE"},
          {"columns", nlohmann::json::array()},
      });
      current = &indexes.back();
      current_name = row[0];
    }
    if (current) {
      (*current)["columns"].push_back(row[2]);
    }
  }
  return nlohmann::json{{"indexes", indexes}};
}

nlohmann::json GetPrimaryKey(session::Session& session, const RelationRef& ref, std::string& error) {
  if (!RequireRelation(ref, error)) {
    return {};
  }
  const std::string sql =
      "SELECT cc.COLUMN_NAME "
      "FROM ALL_CONSTRAINTS c "
      "JOIN ALL_CONS_COLUMNS cc ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME "
      "WHERE c.OWNER = " +
      util::QuoteLiteral(ref.schema) + " AND c.TABLE_NAME = " + util::QuoteLiteral(ref.name) +
      " AND c.CONSTRAINT_TYPE = 'P' ORDER BY cc.POSITION";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, 501, rows, error)) {
    return {};
  }
  nlohmann::json cols = nlohmann::json::array();
  for (const auto& row : rows.rows) {
    if (!row.empty()) {
      cols.push_back(row[0]);
    }
  }
  return nlohmann::json{{"columns", cols}};
}

nlohmann::json ListForeignKeys(session::Session& session, const RelationRef& ref, std::string& error) {
  if (!RequireRelation(ref, error)) {
    return {};
  }
  const std::string sql =
      "SELECT c.CONSTRAINT_NAME, cc.COLUMN_NAME, rc.OWNER, rc.TABLE_NAME, rcc.COLUMN_NAME, "
      "COALESCE(c.DELETE_RULE, ''), cc.POSITION "
      "FROM ALL_CONSTRAINTS c "
      "JOIN ALL_CONS_COLUMNS cc ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME "
      "JOIN ALL_CONSTRAINTS rc ON rc.OWNER = c.R_OWNER AND rc.CONSTRAINT_NAME = c.R_CONSTRAINT_NAME "
      "JOIN ALL_CONS_COLUMNS rcc ON rcc.OWNER = rc.OWNER AND rcc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME "
      "AND rcc.POSITION = cc.POSITION "
      "WHERE c.OWNER = " +
      util::QuoteLiteral(ref.schema) + " AND c.TABLE_NAME = " + util::QuoteLiteral(ref.name) +
      " AND c.CONSTRAINT_TYPE = 'R' ORDER BY c.CONSTRAINT_NAME, cc.POSITION";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, 2001, rows, error)) {
    return {};
  }
  nlohmann::json fks = nlohmann::json::array();
  nlohmann::json* current = nullptr;
  std::string current_name;
  for (const auto& row : rows.rows) {
    if (row.size() < 5) {
      continue;
    }
    if (row[0] != current_name) {
      fks.push_back(nlohmann::json{
          {"name", row[0]},
          {"columns", nlohmann::json::array()},
          {"refSchema", row[2]},
          {"refTable", row[3]},
          {"refColumns", nlohmann::json::array()},
          {"onDelete", row.size() > 5 ? row[5] : ""},
      });
      current = &fks.back();
      current_name = row[0];
    }
    if (current) {
      (*current)["columns"].push_back(row[1]);
      (*current)["refColumns"].push_back(row[4]);
    }
  }
  return nlohmann::json{{"foreignKeys", fks}};
}

nlohmann::json GetDDL(session::Session& session, const RelationRef& ref, std::string& error) {
  if (!RequireRelation(ref, error)) {
    return {};
  }
  if (!session.conn || !session.ctx) {
    error = "oracle: session has no connection";
    return {};
  }

  std::string obj_type = DetectObjectType(session, ref);
  for (char& c : obj_type) {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  }
  if (obj_type != "VIEW") {
    obj_type = "TABLE";
  }

  const std::string sql = "SELECT DBMS_METADATA.GET_DDL(" + util::QuoteLiteral(obj_type) + ", " +
                          util::QuoteLiteral(ref.name) + ", " + util::QuoteLiteral(ref.schema) +
                          ") FROM DUAL";

  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  auto* ctx = session.ctx.get();
  auto* conn = session.conn.get();
  if (dpiConn_prepareStmt(conn, 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0, &raw) < 0) {
    error.clear();
    return RebuildTableDDL(session, ref, error);
  }
  stmt.Reset(raw);
  uint32_t num_cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &num_cols) < 0) {
    error.clear();
    return RebuildTableDDL(session, ref, error);
  }
  int found = 0;
  uint32_t buffer_row = 0;
  if (dpiStmt_fetch(stmt.Get(), &found, &buffer_row) < 0 || !found) {
    error.clear();
    return RebuildTableDDL(session, ref, error);
  }
  dpiNativeTypeNum native = DPI_NATIVE_TYPE_BYTES;
  dpiData* data = nullptr;
  if (dpiStmt_getQueryValue(stmt.Get(), 1, &native, &data) < 0) {
    error.clear();
    return RebuildTableDDL(session, ref, error);
  }
  std::string ddl = ReadLobOrBytes(ctx, native, data, error);
  if (!error.empty() || ddl.empty()) {
    error.clear();
    return RebuildTableDDL(session, ref, error);
  }
  std::string type_out = obj_type == "VIEW" ? "view" : "table";
  return nlohmann::json{{"objectType", type_out}, {"ddl", ddl}};
}

}  // namespace niuma::oracle::meta
