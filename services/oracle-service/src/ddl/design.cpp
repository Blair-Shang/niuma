#include "ddl/design.hpp"

#include "util/ident.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

#include <chrono>
#include <sstream>
#include <vector>

namespace niuma::oracle::ddl {
namespace {

std::string SchemaOf(const nlohmann::json& j) {
  if (j.contains("schema") && j["schema"].is_string()) {
    return j["schema"].get<std::string>();
  }
  if (j.contains("database") && j["database"].is_string()) {
    return j["database"].get<std::string>();
  }
  return {};
}

std::string Rel(const std::string& schema, const std::string& table) {
  return util::QuoteIdent(schema) + "." + util::QuoteIdent(table);
}

bool ValidType(const std::string& dt) {
  if (dt.empty() || dt.size() > 200) {
    return false;
  }
  for (unsigned char c : dt) {
    if (c < 32) {
      return false;
    }
  }
  return true;
}

std::string QuoteCols(const nlohmann::json& cols, std::string& error) {
  if (!cols.is_array() || cols.empty()) {
    error = "oracle: columns required";
    return {};
  }
  std::ostringstream oss;
  for (size_t i = 0; i < cols.size(); ++i) {
    if (!cols[i].is_string() || !util::IsSafeIdent(cols[i].get<std::string>())) {
      error = "oracle: invalid column list";
      return {};
    }
    if (i) {
      oss << ", ";
    }
    oss << util::QuoteIdent(cols[i].get<std::string>());
  }
  return oss.str();
}

std::string BuildOp(const std::string& schema, const std::string& table, const nlohmann::json& op,
                    std::string& error) {
  if (!util::IsSafeIdent(schema) || !util::IsSafeIdent(table)) {
    error = "oracle: schema and name required";
    return {};
  }
  const std::string rel = Rel(schema, table);
  const std::string kind = op.value("op", "");
  const std::string name = op.value("name", "");

  if (kind == "add_column") {
    const std::string dt = op.value("dataType", "");
    if (!util::IsSafeIdent(name) || !ValidType(dt)) {
      error = "oracle: add_column requires name and dataType";
      return {};
    }
    std::ostringstream sql;
    sql << "ALTER TABLE " << rel << " ADD " << util::QuoteIdent(name) << " " << dt;
    if (op.contains("nullable") && op["nullable"].is_boolean() && !op["nullable"].get<bool>()) {
      sql << " NOT NULL";
    }
    if (op.contains("default") && op["default"].is_string()) {
      sql << " DEFAULT " << op["default"].get<std::string>();
    }
    return sql.str();
  }
  if (kind == "drop_column") {
    if (!util::IsSafeIdent(name)) {
      error = "oracle: drop_column requires name";
      return {};
    }
    return "ALTER TABLE " + rel + " DROP COLUMN " + util::QuoteIdent(name);
  }
  if (kind == "rename_column") {
    const std::string neu = op.value("newName", "");
    if (!util::IsSafeIdent(name) || !util::IsSafeIdent(neu)) {
      error = "oracle: rename_column requires name and newName";
      return {};
    }
    return "ALTER TABLE " + rel + " RENAME COLUMN " + util::QuoteIdent(name) + " TO " +
           util::QuoteIdent(neu);
  }
  if (kind == "alter_type") {
    const std::string dt = op.value("dataType", "");
    if (!util::IsSafeIdent(name) || !ValidType(dt)) {
      error = "oracle: alter_type requires name and dataType";
      return {};
    }
    return "ALTER TABLE " + rel + " MODIFY " + util::QuoteIdent(name) + " " + dt;
  }
  if (kind == "set_null" || kind == "set_not_null") {
    if (!util::IsSafeIdent(name)) {
      error = "oracle: nullability op requires name";
      return {};
    }
    const std::string dt = op.value("dataType", "");
    std::ostringstream sql;
    sql << "ALTER TABLE " << rel << " MODIFY " << util::QuoteIdent(name);
    if (!dt.empty()) {
      if (!ValidType(dt)) {
        error = "oracle: invalid dataType";
        return {};
      }
      sql << " " << dt;
    }
    sql << (kind == "set_null" ? " NULL" : " NOT NULL");
    return sql.str();
  }
  if (kind == "set_default") {
    if (!util::IsSafeIdent(name) || !op.contains("default") || !op["default"].is_string()) {
      error = "oracle: set_default requires name and default";
      return {};
    }
    return "ALTER TABLE " + rel + " MODIFY " + util::QuoteIdent(name) + " DEFAULT " +
           op["default"].get<std::string>();
  }
  if (kind == "drop_default") {
    if (!util::IsSafeIdent(name)) {
      error = "oracle: drop_default requires name";
      return {};
    }
    return "ALTER TABLE " + rel + " MODIFY " + util::QuoteIdent(name) + " DEFAULT NULL";
  }
  if (kind == "set_column_comment") {
    if (!util::IsSafeIdent(name)) {
      error = "oracle: set_column_comment requires name";
      return {};
    }
    return "COMMENT ON COLUMN " + rel + "." + util::QuoteIdent(name) + " IS " +
           util::QuoteLiteral(op.value("comment", ""));
  }
  if (kind == "set_table_comment") {
    return "COMMENT ON TABLE " + rel + " IS " + util::QuoteLiteral(op.value("comment", ""));
  }
  if (kind == "add_primary_key") {
    const std::string cols = QuoteCols(op.value("columns", nlohmann::json::array()), error);
    if (!error.empty()) {
      return {};
    }
    if (!name.empty() && util::IsSafeIdent(name)) {
      return "ALTER TABLE " + rel + " ADD CONSTRAINT " + util::QuoteIdent(name) + " PRIMARY KEY (" +
             cols + ")";
    }
    return "ALTER TABLE " + rel + " ADD PRIMARY KEY (" + cols + ")";
  }
  if (kind == "drop_primary_key" || kind == "drop_constraint") {
    if (!util::IsSafeIdent(name)) {
      error = "oracle: drop constraint requires name";
      return {};
    }
    return "ALTER TABLE " + rel + " DROP CONSTRAINT " + util::QuoteIdent(name);
  }
  if (kind == "add_index") {
    const std::string cols = QuoteCols(op.value("columns", nlohmann::json::array()), error);
    if (!error.empty() || !util::IsSafeIdent(name)) {
      error = "oracle: add_index requires name and columns";
      return {};
    }
    const bool unique = op.contains("unique") && op["unique"].is_boolean() && op["unique"].get<bool>();
    return std::string("CREATE ") + (unique ? "UNIQUE " : "") + "INDEX " + util::QuoteIdent(name) +
           " ON " + rel + " (" + cols + ")";
  }
  if (kind == "drop_index") {
    if (!util::IsSafeIdent(name)) {
      error = "oracle: drop_index requires name";
      return {};
    }
    return "DROP INDEX " + util::QuoteIdent(schema) + "." + util::QuoteIdent(name);
  }
  if (kind == "rename_index") {
    const std::string neu = op.value("newName", "");
    if (!util::IsSafeIdent(name) || !util::IsSafeIdent(neu)) {
      error = "oracle: rename_index requires name and newName";
      return {};
    }
    return "ALTER INDEX " + util::QuoteIdent(schema) + "." + util::QuoteIdent(name) + " RENAME TO " +
           util::QuoteIdent(neu);
  }
  if (kind == "add_foreign_key") {
    const std::string cols = QuoteCols(op.value("columns", nlohmann::json::array()), error);
    if (!error.empty()) {
      return {};
    }
    std::string ref_schema = op.value("refSchema", schema);
    if (ref_schema.empty()) {
      ref_schema = op.value("refDatabase", schema);
    }
    const std::string ref_table = op.value("refTable", "");
    const std::string ref_cols = QuoteCols(op.value("refColumns", nlohmann::json::array()), error);
    if (!error.empty() || !util::IsSafeIdent(ref_schema) || !util::IsSafeIdent(ref_table)) {
      error = "oracle: add_foreign_key requires refTable/columns";
      return {};
    }
    std::ostringstream sql;
    sql << "ALTER TABLE " << rel << " ADD";
    if (!name.empty() && util::IsSafeIdent(name)) {
      sql << " CONSTRAINT " << util::QuoteIdent(name);
    }
    sql << " FOREIGN KEY (" << cols << ") REFERENCES " << Rel(ref_schema, ref_table) << " ("
        << ref_cols << ")";
    const std::string on_del = op.value("onDelete", "");
    if (!on_del.empty()) {
      sql << " ON DELETE " << on_del;
    }
    return sql.str();
  }
  error = "oracle: unsupported design op " + kind;
  return {};
}

std::vector<std::string> BuildOps(const std::string& schema, const std::string& table,
                                  const nlohmann::json& ops, std::string& error) {
  std::vector<std::string> sqls;
  if (!ops.is_array() || ops.empty()) {
    error = "oracle: no design ops";
    return sqls;
  }
  for (const auto& op : ops) {
    auto sql = BuildOp(schema, table, op, error);
    if (!error.empty()) {
      return {};
    }
    sqls.push_back(sql);
  }
  return sqls;
}

bool ExecSql(session::Session& session, const std::string& sql, std::string& error) {
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(session.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()),
                          nullptr, 0, &raw) < 0) {
    error = "oracle: ddl prepare failed";
    return false;
  }
  stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    dpiErrorInfo info{};
    dpiContext_getError(session.ctx.get(), &info);
    error = info.message ? std::string("oracle: ") + info.message : "oracle: ddl exec failed";
    return false;
  }
  return true;
}

std::string BuildCreateTable(const nlohmann::json& params, std::string& error) {
  const std::string schema = SchemaOf(params);
  const std::string name = params.value("name", "");
  if (!util::IsSafeIdent(schema) || !util::IsSafeIdent(name)) {
    error = "oracle: schema and name required";
    return {};
  }
  if (!params.contains("columns") || !params["columns"].is_array() || params["columns"].empty()) {
    error = "oracle: columns required";
    return {};
  }
  std::ostringstream sql;
  sql << "CREATE TABLE " << Rel(schema, name) << " (\n";
  const auto& cols = params["columns"];
  for (size_t i = 0; i < cols.size(); ++i) {
    const auto& c = cols[i];
    const std::string cname = c.value("name", "");
    const std::string dt = c.value("dataType", "");
    if (!util::IsSafeIdent(cname) || !ValidType(dt)) {
      error = "oracle: invalid column";
      return {};
    }
    sql << "  " << util::QuoteIdent(cname) << " " << dt;
    if (c.contains("nullable") && c["nullable"].is_boolean() && !c["nullable"].get<bool>()) {
      sql << " NOT NULL";
    }
    if (c.contains("default") && c["default"].is_string()) {
      sql << " DEFAULT " << c["default"].get<std::string>();
    }
    if (i + 1 < cols.size()) {
      sql << ",";
    }
    sql << "\n";
  }
  sql << ")";
  return sql.str();
}

}  // namespace

nlohmann::json DesignPreview(const nlohmann::json& params, std::string& error) {
  const std::string schema = SchemaOf(params);
  const std::string name = params.value("name", "");
  auto sqls = BuildOps(schema, name, params.value("ops", nlohmann::json::array()), error);
  if (!error.empty()) {
    return {};
  }
  return nlohmann::json{{"sql", sqls}};
}

nlohmann::json DesignApply(session::Session& session, const nlohmann::json& params,
                           std::string& error) {
  const auto started = std::chrono::steady_clock::now();
  auto preview = DesignPreview(params, error);
  if (!error.empty()) {
    return {};
  }
  for (const auto& sql : preview["sql"]) {
    if (!ExecSql(session, sql.get<std::string>(), error)) {
      return {};
    }
  }
  dpiConn_commit(session.conn.get());
  const auto ms =
      std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started)
          .count();
  preview["durationMs"] = ms;
  return preview;
}

nlohmann::json CreateTablePreview(const nlohmann::json& params, std::string& error) {
  auto sql = BuildCreateTable(params, error);
  if (!error.empty()) {
    return {};
  }
  return nlohmann::json{{"sql", nlohmann::json::array({sql})}};
}

nlohmann::json CreateTable(session::Session& session, const nlohmann::json& params,
                           std::string& error) {
  const auto started = std::chrono::steady_clock::now();
  auto preview = CreateTablePreview(params, error);
  if (!error.empty()) {
    return {};
  }
  for (const auto& sql : preview["sql"]) {
    if (!ExecSql(session, sql.get<std::string>(), error)) {
      return {};
    }
  }
  dpiConn_commit(session.conn.get());
  const auto ms =
      std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started)
          .count();
  preview["durationMs"] = ms;
  return preview;
}

}  // namespace niuma::oracle::ddl
