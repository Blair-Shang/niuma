#include "catalog/list.hpp"

#include "meta/system_users.hpp"
#include "session/sql_rows.hpp"
#include "util/ident.hpp"
#include "util/sql_literal.hpp"

#include <cctype>

namespace niuma::oracle::catalog {

ListParams ListParams::FromJson(const nlohmann::json& j) {
  ListParams p;
  if (j.contains("schema") && j["schema"].is_string()) {
    p.schema = j["schema"].get<std::string>();
  }
  if (j.contains("table") && j["table"].is_string()) {
    p.table = j["table"].get<std::string>();
  }
  if (j.contains("prefix") && j["prefix"].is_string()) {
    p.prefix = j["prefix"].get<std::string>();
  }
  if (j.contains("limit") && j["limit"].is_number_integer()) {
    p.limit = j["limit"].get<int>();
  }
  return p;
}

nlohmann::json ListSchemas(session::Session& session, const ListParams& params, std::string& error) {
  const int limit = util::ClampListLimit(params.limit, 200, 2000);
  const std::string like = util::QuoteLiteral(util::LikePrefixPattern(params.prefix));
  const std::string sql =
      "SELECT USERNAME FROM ALL_USERS WHERE UPPER(USERNAME) LIKE UPPER(" + like +
      ") ESCAPE '\\' ORDER BY USERNAME";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, limit + 1, rows, error)) {
    error.clear();
    const std::string fallback =
        "SELECT USERNAME FROM USER_USERS WHERE UPPER(USERNAME) LIKE UPPER(" + like +
        ") ESCAPE '\\' ORDER BY USERNAME";
    if (!session::ExecStringRows(session, fallback, limit + 1, rows, error)) {
      return {};
    }
  }

  nlohmann::json schemas = nlohmann::json::array();
  bool truncated = rows.truncated;
  for (const auto& row : rows.rows) {
    if (row.empty()) {
      continue;
    }
    if (meta::IsSystemSchema(row[0])) {
      continue;
    }
    if (static_cast<int>(schemas.size()) >= limit) {
      truncated = true;
      break;
    }
    schemas.push_back({{"name", row[0]}});
  }
  nlohmann::json out{{"schemas", schemas}};
  if (truncated) {
    out["truncated"] = true;
  }
  return out;
}

nlohmann::json ListTables(session::Session& session, const ListParams& params, std::string& error) {
  if (params.schema.empty() || !util::IsSafeIdent(params.schema)) {
    error = "oracle: schema required";
    return {};
  }
  const int limit = util::ClampListLimit(params.limit, 200, 2000);
  const std::string owner = util::QuoteLiteral(params.schema);
  const std::string like = util::QuoteLiteral(util::LikePrefixPattern(params.prefix));
  const std::string sql =
      "SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OWNER = " + owner +
      " AND OBJECT_TYPE IN ('TABLE','VIEW') AND OBJECT_NAME LIKE " + like +
      " ESCAPE '\\' ORDER BY OBJECT_NAME";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, limit + 1, rows, error)) {
    return {};
  }

  nlohmann::json tables = nlohmann::json::array();
  bool truncated = rows.truncated;
  for (const auto& row : rows.rows) {
    if (row.size() < 2) {
      continue;
    }
    if (static_cast<int>(tables.size()) >= limit) {
      truncated = true;
      break;
    }
    std::string typ = row[1];
    for (char& c : typ) {
      c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    tables.push_back({{"name", row[0]}, {"type", typ}, {"schema", params.schema}});
  }
  nlohmann::json out{{"tables", tables}};
  if (truncated) {
    out["truncated"] = true;
  }
  return out;
}

nlohmann::json ListColumns(session::Session& session, const ListParams& params, std::string& error) {
  if (params.schema.empty() || !util::IsSafeIdent(params.schema)) {
    error = "oracle: schema required";
    return {};
  }
  if (params.table.empty() || !util::IsSafeIdent(params.table)) {
    error = "oracle: table required";
    return {};
  }
  const int limit = util::ClampListLimit(params.limit, 200, 2000);
  const std::string owner = util::QuoteLiteral(params.schema);
  const std::string table = util::QuoteLiteral(params.table);
  const std::string like = util::QuoteLiteral(util::LikePrefixPattern(params.prefix));
  const std::string sql =
      "SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS WHERE OWNER = " + owner +
      " AND TABLE_NAME = " + table + " AND COLUMN_NAME LIKE " + like +
      " ESCAPE '\\' ORDER BY COLUMN_ID";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, limit + 1, rows, error)) {
    return {};
  }

  nlohmann::json columns = nlohmann::json::array();
  bool truncated = rows.truncated;
  for (const auto& row : rows.rows) {
    if (row.empty()) {
      continue;
    }
    if (static_cast<int>(columns.size()) >= limit) {
      truncated = true;
      break;
    }
    nlohmann::json col{{"name", row[0]}, {"schema", params.schema}, {"table", params.table}};
    if (row.size() > 1) {
      col["dataType"] = row[1];
    }
    columns.push_back(std::move(col));
  }
  nlohmann::json out{{"columns", columns}};
  if (truncated) {
    out["truncated"] = true;
  }
  return out;
}

}  // namespace niuma::oracle::catalog
