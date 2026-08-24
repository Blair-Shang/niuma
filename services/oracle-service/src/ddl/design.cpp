#include "ddl/design.hpp"

#include "util/dpi_error.hpp"
#include "util/ident.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <sstream>
#include <string>
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

std::string ToUpper(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(),
                 [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
  return s;
}

std::string CollapseWs(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  bool prev_space = false;
  for (unsigned char c : s) {
    if (std::isspace(c)) {
      if (!out.empty() && !prev_space) {
        out.push_back(' ');
        prev_space = true;
      }
      continue;
    }
    out.push_back(static_cast<char>(c));
    prev_space = false;
  }
  while (!out.empty() && out.back() == ' ') {
    out.pop_back();
  }
  return out;
}

bool HasForbiddenTypeChars(const std::string& dt) {
  if (dt.empty() || dt.size() > 200) {
    return true;
  }
  for (unsigned char c : dt) {
    if (c < 32 || c == ';' || c == '\'' || c == '"' || c == '`') {
      return true;
    }
  }
  const std::string lower = ToUpper(dt);
  return lower.find("--") != std::string::npos || lower.find("/*") != std::string::npos ||
         lower.find("*/") != std::string::npos;
}

/** 校验 Oracle 数据类型字面量（基础名 + 可选精度括号）。 */
bool ValidType(const std::string& raw) {
  if (HasForbiddenTypeChars(raw)) {
    return false;
  }
  std::string dt = CollapseWs(raw);
  if (dt.empty()) {
    return false;
  }

  std::string base = dt;
  std::string params;
  const auto lparen = dt.find('(');
  if (lparen != std::string::npos) {
    if (dt.back() != ')') {
      return false;
    }
    base = CollapseWs(dt.substr(0, lparen));
    params = dt.substr(lparen + 1, dt.size() - lparen - 2);
    for (unsigned char c : params) {
      if (!(std::isdigit(c) || c == ',' || c == ' ')) {
        return false;
      }
    }
  }

  const std::string upper = ToUpper(base);
  static const char* kExact[] = {
      "NUMBER",
      "INTEGER",
      "INT",
      "SMALLINT",
      "FLOAT",
      "BINARY_FLOAT",
      "BINARY_DOUBLE",
      "REAL",
      "DOUBLE PRECISION",
      "VARCHAR2",
      "NVARCHAR2",
      "CHAR",
      "NCHAR",
      "RAW",
      "LONG",
      "LONG RAW",
      "CLOB",
      "NCLOB",
      "BLOB",
      "BFILE",
      "DATE",
      "TIMESTAMP",
      "TIMESTAMP WITH TIME ZONE",
      "TIMESTAMP WITH LOCAL TIME ZONE",
      "INTERVAL YEAR TO MONTH",
      "INTERVAL DAY TO SECOND",
      "BOOLEAN",
      "JSON",
      "XMLTYPE",
      "ROWID",
      "UROWID",
  };
  for (const char* t : kExact) {
    if (upper == t) {
      return true;
    }
  }
  return false;
}

bool BoolFlag(const nlohmann::json& j, const char* key) {
  return j.contains(key) && j[key].is_boolean() && j[key].get<bool>();
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

std::string NormalizeFkOnDelete(const std::string& raw, std::string& error) {
  if (raw.empty()) {
    return {};
  }
  const std::string upper = ToUpper(CollapseWs(raw));
  if (upper == "NO ACTION" || upper == "CASCADE" || upper == "SET NULL" || upper == "SET DEFAULT") {
    return upper;
  }
  error = "oracle: unsupported ON DELETE action";
  return {};
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
    sql << "ALTER TABLE " << rel << " ADD " << util::QuoteIdent(name) << " " << CollapseWs(dt);
    const bool identity = BoolFlag(op, "autoIncrement");
    if (identity) {
      sql << " GENERATED BY DEFAULT AS IDENTITY";
    }
    if (!identity && op.contains("default") && op["default"].is_string()) {
      sql << " DEFAULT " << op["default"].get<std::string>();
    }
    if (op.contains("nullable") && op["nullable"].is_boolean() && !op["nullable"].get<bool>()) {
      sql << " NOT NULL";
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
    if (!util::IsSafeIdent(name) || dt.empty() || HasForbiddenTypeChars(dt)) {
      error = "oracle: alter_type requires name and dataType";
      return {};
    }
    // dataType 可含 GENERATED / NULL / DEFAULT 子句，仅做注入字符校验
    return "ALTER TABLE " + rel + " MODIFY " + util::QuoteIdent(name) + " " + CollapseWs(dt);
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
      sql << " " << CollapseWs(dt);
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
  if (kind == "drop_primary_key") {
    // Oracle 无 DROP PRIMARY KEY 语法；需约束名。未提供时由调用方先查元数据。
    if (!util::IsSafeIdent(name)) {
      error = "oracle: drop_primary_key requires constraint name";
      return {};
    }
    return "ALTER TABLE " + rel + " DROP CONSTRAINT " + util::QuoteIdent(name);
  }
  if (kind == "drop_constraint") {
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
    const bool unique = BoolFlag(op, "unique");
    const std::string method = ToUpper(op.value("method", "NORMAL"));
    if (method == "BITMAP") {
      if (unique) {
        error = "oracle: BITMAP index cannot be UNIQUE";
        return {};
      }
      return "CREATE BITMAP INDEX " + util::QuoteIdent(name) + " ON " + rel + " (" + cols + ")";
    }
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
    const std::string on_del = NormalizeFkOnDelete(op.value("onDelete", ""), error);
    if (!error.empty()) {
      return {};
    }
    if (!on_del.empty() && on_del != "NO ACTION") {
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
    error = util::FormatDpiError(session.ctx.get(), "oracle: ddl prepare failed");
    return false;
  }
  stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    error = util::FormatDpiError(session.ctx.get(), "oracle: ddl exec failed");
    return false;
  }
  return true;
}

std::vector<std::string> BuildCreateTable(const nlohmann::json& params, std::string& error) {
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

  const auto& cols = params["columns"];
  std::vector<std::string> col_lines;
  std::vector<std::string> pk_cols;
  std::vector<std::pair<std::string, std::string>> col_comments;
  col_lines.reserve(cols.size());

  for (size_t i = 0; i < cols.size(); ++i) {
    const auto& c = cols[i];
    const std::string cname = c.value("name", "");
    const std::string dt = CollapseWs(c.value("dataType", ""));
    if (!util::IsSafeIdent(cname) || !ValidType(dt)) {
      error = "oracle: invalid column";
      return {};
    }
    const bool identity = BoolFlag(c, "autoIncrement");
    std::ostringstream line;
    line << "  " << util::QuoteIdent(cname) << " " << dt;
    if (identity) {
      line << " GENERATED BY DEFAULT AS IDENTITY";
    }
    if (!identity && c.contains("default") && c["default"].is_string()) {
      const std::string def = c["default"].get<std::string>();
      if (!def.empty()) {
        line << " DEFAULT " << def;
      }
    }
    if (c.contains("nullable") && c["nullable"].is_boolean() && !c["nullable"].get<bool>()) {
      line << " NOT NULL";
    }
    col_lines.push_back(line.str());

    if (BoolFlag(c, "primaryKey")) {
      pk_cols.push_back(util::QuoteIdent(cname));
    }
    if (c.contains("comment") && c["comment"].is_string()) {
      const std::string comment = c["comment"].get<std::string>();
      if (!comment.empty()) {
        col_comments.emplace_back(cname, comment);
      }
    }
  }

  std::ostringstream create_sql;
  create_sql << "CREATE TABLE " << Rel(schema, name) << " (\n";
  for (size_t i = 0; i < col_lines.size(); ++i) {
    create_sql << col_lines[i];
    const bool more = (i + 1 < col_lines.size()) || !pk_cols.empty() ||
                      (params.contains("foreignKeys") && params["foreignKeys"].is_array() &&
                       !params["foreignKeys"].empty());
    if (more) {
      create_sql << ",";
    }
    create_sql << "\n";
  }

  if (!pk_cols.empty()) {
    create_sql << "  PRIMARY KEY (";
    for (size_t i = 0; i < pk_cols.size(); ++i) {
      if (i) {
        create_sql << ", ";
      }
      create_sql << pk_cols[i];
    }
    create_sql << ")";
    const bool more_fk = params.contains("foreignKeys") && params["foreignKeys"].is_array() &&
                         !params["foreignKeys"].empty();
    if (more_fk) {
      create_sql << ",";
    }
    create_sql << "\n";
  }

  if (params.contains("foreignKeys") && params["foreignKeys"].is_array()) {
    const auto& fks = params["foreignKeys"];
    for (size_t i = 0; i < fks.size(); ++i) {
      const auto& fk = fks[i];
      const std::string cols_sql = QuoteCols(fk.value("columns", nlohmann::json::array()), error);
      if (!error.empty()) {
        return {};
      }
      std::string ref_schema = fk.value("refSchema", schema);
      if (ref_schema.empty()) {
        ref_schema = fk.value("refDatabase", schema);
      }
      const std::string ref_table = fk.value("refTable", "");
      const std::string ref_cols =
          QuoteCols(fk.value("refColumns", nlohmann::json::array()), error);
      if (!error.empty() || !util::IsSafeIdent(ref_schema) || !util::IsSafeIdent(ref_table)) {
        error = "oracle: invalid foreign key";
        return {};
      }
      const std::string fk_name = fk.value("name", "");
      create_sql << "  ";
      if (!fk_name.empty() && util::IsSafeIdent(fk_name)) {
        create_sql << "CONSTRAINT " << util::QuoteIdent(fk_name) << " ";
      }
      create_sql << "FOREIGN KEY (" << cols_sql << ") REFERENCES " << Rel(ref_schema, ref_table)
                 << " (" << ref_cols << ")";
      const std::string on_del = NormalizeFkOnDelete(fk.value("onDelete", ""), error);
      if (!error.empty()) {
        return {};
      }
      if (!on_del.empty() && on_del != "NO ACTION") {
        create_sql << " ON DELETE " << on_del;
      }
      if (i + 1 < fks.size()) {
        create_sql << ",";
      }
      create_sql << "\n";
    }
  }

  create_sql << ")";

  std::vector<std::string> sqls;
  sqls.push_back(create_sql.str());

  if (params.contains("indexes") && params["indexes"].is_array()) {
    for (const auto& idx : params["indexes"]) {
      const std::string iname = idx.value("name", "");
      const std::string cols_sql = QuoteCols(idx.value("columns", nlohmann::json::array()), error);
      if (!error.empty() || !util::IsSafeIdent(iname)) {
        error = "oracle: invalid index";
        return {};
      }
      const bool unique = BoolFlag(idx, "unique");
      const std::string method = ToUpper(idx.value("method", "NORMAL"));
      if (method == "BITMAP") {
        if (unique) {
          error = "oracle: BITMAP index cannot be UNIQUE";
          return {};
        }
        sqls.push_back("CREATE BITMAP INDEX " + util::QuoteIdent(iname) + " ON " + Rel(schema, name) +
                       " (" + cols_sql + ")");
      } else {
        sqls.push_back(std::string("CREATE ") + (unique ? "UNIQUE " : "") + "INDEX " +
                       util::QuoteIdent(iname) + " ON " + Rel(schema, name) + " (" + cols_sql + ")");
      }
    }
  }

  if (params.contains("comment") && params["comment"].is_string()) {
    const std::string comment = params["comment"].get<std::string>();
    if (!comment.empty()) {
      sqls.push_back("COMMENT ON TABLE " + Rel(schema, name) + " IS " + util::QuoteLiteral(comment));
    }
  }
  for (const auto& [cname, comment] : col_comments) {
    sqls.push_back("COMMENT ON COLUMN " + Rel(schema, name) + "." + util::QuoteIdent(cname) +
                   " IS " + util::QuoteLiteral(comment));
  }

  return sqls;
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
  auto sqls = BuildCreateTable(params, error);
  if (!error.empty()) {
    return {};
  }
  return nlohmann::json{{"sql", sqls}};
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
