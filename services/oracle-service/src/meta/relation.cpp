#include "meta/relation.hpp"

#include "meta/column_type.hpp"
#include "meta/metadata_ddl.hpp"
#include "session/sql_rows.hpp"
#include "util/dpi_error.hpp"
#include "util/ident.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

#include <cctype>
#include <sstream>

namespace niuma::oracle::meta {
namespace {

std::string DpiError(dpiContext* ctx) {
  return util::FormatDpiError(ctx, "oracle: meta error");
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

std::string DetectObjectType(session::Session& session, const RelationRef& ref) {
  // 大小写不敏感匹配；同名优先精确 OBJECT_NAME，其次 VIEW（避免视图误判为表后拼 CREATE TABLE）。
  const std::string sql =
      "SELECT OBJECT_TYPE FROM ALL_OBJECTS WHERE UPPER(OWNER) = UPPER(" + util::QuoteLiteral(ref.schema) +
      ") AND OBJECT_NAME IN (" + util::QuoteLiteral(ref.name) + ", UPPER(" + util::QuoteLiteral(ref.name) +
      ")) AND OBJECT_TYPE IN ('TABLE','VIEW') ORDER BY CASE "
      "WHEN OBJECT_NAME = " + util::QuoteLiteral(ref.name) + " AND OBJECT_TYPE = 'VIEW' THEN 0 "
      "WHEN OBJECT_NAME = " + util::QuoteLiteral(ref.name) + " THEN 1 "
      "WHEN OBJECT_TYPE = 'VIEW' THEN 2 ELSE 3 END FETCH FIRST 1 ROWS ONLY";
  session::SqlRowsResult rows;
  std::string err;
  if (!session::ExecStringRows(session, sql, 2, rows, err) || rows.rows.empty() || rows.rows[0].empty()) {
    return {};
  }
  return rows.rows[0][0];
}

/** 从 ALL_VIEWS 拼 CREATE OR REPLACE VIEW（GET_DDL 失败时的降级，绝不拼成 TABLE）。 */
nlohmann::json RebuildViewDDL(session::Session& session, const RelationRef& ref, std::string& error) {
  const std::string sql =
      "SELECT VIEW_NAME, TEXT FROM ALL_VIEWS WHERE UPPER(OWNER) = UPPER(" +
      util::QuoteLiteral(ref.schema) + ") AND VIEW_NAME IN (" + util::QuoteLiteral(ref.name) +
      ", UPPER(" + util::QuoteLiteral(ref.name) + ")) ORDER BY CASE WHEN VIEW_NAME = " +
      util::QuoteLiteral(ref.name) + " THEN 0 ELSE 1 END FETCH FIRST 1 ROWS ONLY";
  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, 2, rows, error) || rows.rows.empty() ||
      rows.rows[0].size() < 2) {
    if (error.empty()) {
      error = "oracle: view ddl not found: " + ref.schema + "." + ref.name;
    }
    return {};
  }
  const std::string& view_name = rows.rows[0][0];
  const std::string& text = rows.rows[0][1];
  if (text.empty()) {
    error = "oracle: view text empty (LONG may be truncated); check DBMS_METADATA privileges: " +
            ref.schema + "." + ref.name;
    return {};
  }
  std::ostringstream oss;
  oss << "CREATE OR REPLACE VIEW " << util::QuoteIdent(ref.schema) << "." << util::QuoteIdent(view_name)
      << " AS\n"
      << text;
  std::string ddl = oss.str();
  while (!ddl.empty() && (ddl.back() == '\n' || ddl.back() == '\r' || ddl.back() == ' ')) {
    ddl.pop_back();
  }
  if (!ddl.empty() && ddl.back() != ';') {
    ddl.push_back(';');
  }
  return nlohmann::json{{"objectType", "view"}, {"ddl", ddl}};
}

nlohmann::json RebuildTableDDL(session::Session& session, const RelationRef& ref, std::string& error) {
  auto cols = ListColumns(session, ref, error);
  if (!error.empty()) {
    return {};
  }
  std::string pk_err;
  const auto pk = GetPrimaryKey(session, ref, pk_err);
  const auto& pk_cols = pk.value("columns", nlohmann::json::array());

  std::ostringstream oss;
  oss << "CREATE TABLE " << util::QuoteIdent(ref.schema) << "." << util::QuoteIdent(ref.name) << " (\n";
  const auto& arr = cols["columns"];
  for (size_t i = 0; i < arr.size(); ++i) {
    const auto& c = arr[i];
    oss << "  " << util::QuoteIdent(c.value("name", "")) << " " << c.value("dataType", "VARCHAR2(1)");
    if (c.contains("default") && !c["default"].is_null()) {
      const std::string def = TrimOracleDefault(c["default"].get<std::string>());
      if (!def.empty()) {
        oss << " DEFAULT " << def;
      }
    }
    if (!c.value("nullable", true)) {
      oss << " NOT NULL";
    }
    const bool more_cols = i + 1 < arr.size();
    const bool has_pk = !pk_cols.empty();
    if (more_cols || has_pk) {
      oss << ",";
    }
    oss << "\n";
  }
  if (!pk_cols.empty()) {
    oss << "  CONSTRAINT ";
    oss << util::QuoteIdent("PK_" + ref.name);
    oss << " PRIMARY KEY (";
    for (size_t i = 0; i < pk_cols.size(); ++i) {
      if (i) {
        oss << ", ";
      }
      oss << util::QuoteIdent(pk_cols[i].get<std::string>());
    }
    oss << ")\n";
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
  if (j.contains("objectType") && j["objectType"].is_string()) {
    r.object_type = j["objectType"].get<std::string>();
  } else if (j.contains("object_type") && j["object_type"].is_string()) {
    r.object_type = j["object_type"].get<std::string>();
  }
  return r;
}

nlohmann::json ListColumns(session::Session& session, const RelationRef& ref, std::string& error) {
  if (!RequireRelation(ref, error)) {
    return {};
  }
  const std::string sql =
      "SELECT c.COLUMN_NAME, " + std::string(kAllTabColumnsTypeExpr) +
      ", c.NULLABLE, c.DATA_DEFAULT, c.COLUMN_ID, "
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
      col["default"] = TrimOracleDefault(row[3]);
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

  std::string hint = ref.object_type;
  for (char& c : hint) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }

  // 同义词 / 触发器 / 序列：按调用方提示走 DBMS_METADATA，勿降级成表重建。
  if (hint == "synonym" || hint == "trigger" || hint == "sequence") {
    std::string obj_type = hint;
    for (char& c : obj_type) {
      c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    }
    std::string resolve_err;
    std::string dict_owner;
    std::string dict_name;
    if (!ResolveDictionaryObject(session, ref.schema, ref.name, obj_type, dict_owner, dict_name,
                                 resolve_err)) {
      dict_owner = ref.schema;
      dict_name = ref.name;
    }
    std::string ddl;
    if (!FetchDbmsMetadataDdl(session, obj_type, dict_owner, dict_name, ddl, error)) {
      return {};
    }
    return nlohmann::json{{"objectType", hint}, {"ddl", ddl}};
  }

  std::string obj_type = DetectObjectType(session, ref);
  for (char& c : obj_type) {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  }
  if (obj_type != "VIEW" && obj_type != "TABLE") {
    // 字典未命中时：尊重调用方提示（编辑视图），否则默认 TABLE
    obj_type = hint == "view" ? "VIEW" : "TABLE";
  } else if (hint == "view") {
    // 明确要求视图时，即使误检成 TABLE 也按 VIEW 取 DDL
    obj_type = "VIEW";
  } else if (hint == "table") {
    obj_type = "TABLE";
  }

  std::string resolve_err;
  std::string dict_owner;
  std::string dict_name;
  if (!ResolveDictionaryObject(session, ref.schema, ref.name, obj_type, dict_owner, dict_name,
                               resolve_err)) {
    dict_owner = ref.schema;
    dict_name = ref.name;
  }

  std::string ddl;
  if (FetchDbmsMetadataDdl(session, obj_type, dict_owner, dict_name, ddl, error)) {
    return nlohmann::json{{"objectType", obj_type == "VIEW" ? "view" : "table"}, {"ddl", ddl}};
  }

  // 视图：GET_DDL 失败时用 ALL_VIEWS 重建，绝不可降级成 CREATE TABLE（列投影会误导编辑页）。
  if (obj_type == "VIEW") {
    error.clear();
    return RebuildViewDDL(session, ref, error);
  }

  error.clear();
  return RebuildTableDDL(session, ref, error);
}

}  // namespace niuma::oracle::meta
