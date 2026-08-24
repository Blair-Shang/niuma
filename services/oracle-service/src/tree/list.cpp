#include "tree/list.hpp"

#include "meta/system_users.hpp"
#include "session/sql_rows.hpp"
#include "util/ident.hpp"
#include "util/sql_literal.hpp"

#include <cctype>
#include <cstring>
#include <sstream>

namespace niuma::oracle::tree {
namespace {

std::string Lower(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return s;
}

bool WantType(const std::vector<std::string>& types, const char* name) {
  if (types.empty()) {
    return true;
  }
  const std::string target = name;
  for (const auto& t : types) {
    if (Lower(t) == target) {
      return true;
    }
  }
  return false;
}

}  // namespace

ListParams ListParams::FromJson(const nlohmann::json& j) {
  ListParams p;
  if (j.contains("schema") && j["schema"].is_string()) {
    p.schema = j["schema"].get<std::string>();
  }
  if (j.contains("filter") && j["filter"].is_string()) {
    p.filter = j["filter"].get<std::string>();
  }
  if (j.contains("limit") && j["limit"].is_number_integer()) {
    p.limit = j["limit"].get<int>();
  }
  if (j.contains("excludeSystem") && j["excludeSystem"].is_boolean()) {
    p.exclude_system = j["excludeSystem"].get<bool>();
  } else if (j.contains("exclude_system") && j["exclude_system"].is_boolean()) {
    p.exclude_system = j["exclude_system"].get<bool>();
  }
  if (j.contains("types") && j["types"].is_array()) {
    for (const auto& t : j["types"]) {
      if (t.is_string()) {
        p.types.push_back(t.get<std::string>());
      }
    }
  }
  return p;
}

nlohmann::json ListSchemas(session::Session& session, const ListParams& params, std::string& error) {
  const int limit = util::ClampListLimit(params.limit);
  const std::string like = util::QuoteLiteral(util::LikePrefixPattern(params.filter));
  const std::string sql =
      "SELECT USERNAME FROM ALL_USERS WHERE UPPER(USERNAME) LIKE UPPER(" + like +
      ") ESCAPE '\\' ORDER BY USERNAME";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, limit + 1, rows, error)) {
    // 降级 USER_USERS
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
    const std::string& name = row[0];
    if (params.exclude_system && meta::IsSystemSchema(name)) {
      continue;
    }
    if (static_cast<int>(schemas.size()) >= limit) {
      truncated = true;
      break;
    }
    schemas.push_back({{"name", name}});
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
  const int limit = util::ClampListLimit(params.limit);
  const std::string owner = util::QuoteLiteral(params.schema);
  const std::string like = util::QuoteLiteral(util::LikePrefixPattern(params.filter));

  nlohmann::json tables = nlohmann::json::array();
  bool truncated = false;

  auto append = [&](const std::string& sql, const char* type) -> bool {
    const bool default_types = params.types.empty();
    if (default_types) {
      if (std::strcmp(type, "table") != 0 && std::strcmp(type, "view") != 0) {
        return true;
      }
    } else if (!WantType(params.types, type)) {
      return true;
    }
    const int remain = limit + 1 - static_cast<int>(tables.size());
    if (remain <= 0) {
      truncated = true;
      return true;
    }
    session::SqlRowsResult rows;
    if (!session::ExecStringRows(session, sql, remain, rows, error)) {
      return false;
    }
    if (rows.truncated) {
      truncated = true;
    }
    for (const auto& row : rows.rows) {
      if (row.empty()) {
        continue;
      }
      if (static_cast<int>(tables.size()) >= limit) {
        truncated = true;
        return true;
      }
      tables.push_back({{"name", row[0]}, {"type", type}, {"schema", params.schema}});
    }
    return true;
  };

  const std::string table_sql = "SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = " + owner +
                                " AND TABLE_NAME LIKE " + like + " ESCAPE '\\' ORDER BY TABLE_NAME";
  const std::string view_sql = "SELECT VIEW_NAME FROM ALL_VIEWS WHERE OWNER = " + owner +
                               " AND VIEW_NAME LIKE " + like + " ESCAPE '\\' ORDER BY VIEW_NAME";

  if (!append(table_sql, "table")) {
    return {};
  }
  if (!truncated && !append(view_sql, "view")) {
    return {};
  }

  nlohmann::json out{{"tables", tables}, {"objects", tables}};
  if (truncated) {
    out["truncated"] = true;
  }
  return out;
}

nlohmann::json ListRoutines(session::Session& session, const ListParams& params, std::string& error) {
  if (params.schema.empty() || !util::IsSafeIdent(params.schema)) {
    error = "oracle: schema required";
    return {};
  }
  const int limit = util::ClampListLimit(params.limit);
  const std::string owner = util::QuoteLiteral(params.schema);
  const std::string like = util::QuoteLiteral(util::LikePrefixPattern(params.filter));

  std::vector<std::string> type_specs;
  const bool default_types = params.types.empty();
  if (default_types || WantType(params.types, "procedure") || WantType(params.types, "function")) {
    if (default_types || WantType(params.types, "procedure")) type_specs.push_back("PROCEDURE");
    if (default_types || WantType(params.types, "function")) type_specs.push_back("FUNCTION");
  }
  if (!default_types) {
    if (WantType(params.types, "synonym")) type_specs.push_back("SYNONYM");
    if (WantType(params.types, "trigger")) type_specs.push_back("TRIGGER");
  }
  if (type_specs.empty()) {
    return nlohmann::json{{"routines", nlohmann::json::array()}, {"objects", nlohmann::json::array()}};
  }

  std::ostringstream in_list;
  for (size_t i = 0; i < type_specs.size(); ++i) {
    if (i) in_list << ", ";
    in_list << util::QuoteLiteral(type_specs[i]);
  }
  const std::string sql =
      "SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OWNER = " + owner +
      " AND OBJECT_TYPE IN (" + in_list.str() + ") AND OBJECT_NAME LIKE " + like +
      " ESCAPE '\\' ORDER BY OBJECT_NAME";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, limit + 1, rows, error)) {
    return {};
  }

  nlohmann::json routines = nlohmann::json::array();
  bool truncated = rows.truncated;
  for (const auto& row : rows.rows) {
    if (row.size() < 2) {
      continue;
    }
    const std::string kind = Lower(row[1]);
    if (!params.types.empty() && !WantType(params.types, kind.c_str())) {
      continue;
    }
    if (static_cast<int>(routines.size()) >= limit) {
      truncated = true;
      break;
    }
    routines.push_back({{"name", row[0]}, {"type", kind}, {"schema", params.schema}});
  }
  nlohmann::json out{{"routines", routines}, {"objects", routines}};
  if (truncated) {
    out["truncated"] = true;
  }
  return out;
}

nlohmann::json ListSequences(session::Session& session, const ListParams& params, std::string& error) {
  if (params.schema.empty() || !util::IsSafeIdent(params.schema)) {
    error = "oracle: schema required";
    return {};
  }
  const int limit = util::ClampListLimit(params.limit);
  const std::string owner = util::QuoteLiteral(params.schema);
  const std::string like = util::QuoteLiteral(util::LikePrefixPattern(params.filter));
  const std::string sql = "SELECT SEQUENCE_NAME FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER = " + owner +
                          " AND SEQUENCE_NAME LIKE " + like + " ESCAPE '\\' ORDER BY SEQUENCE_NAME";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, limit + 1, rows, error)) {
    return {};
  }
  nlohmann::json sequences = nlohmann::json::array();
  bool truncated = rows.truncated;
  for (const auto& row : rows.rows) {
    if (row.empty()) {
      continue;
    }
    if (static_cast<int>(sequences.size()) >= limit) {
      truncated = true;
      break;
    }
    sequences.push_back({{"name", row[0]}, {"type", "sequence"}, {"schema", params.schema}});
  }
  nlohmann::json out{{"sequences", sequences}, {"objects", sequences}};
  if (truncated) {
    out["truncated"] = true;
  }
  return out;
}

nlohmann::json ListPackages(session::Session& session, const ListParams& params, std::string& error) {
  if (params.schema.empty() || !util::IsSafeIdent(params.schema)) {
    error = "oracle: schema required";
    return {};
  }
  const int limit = util::ClampListLimit(params.limit);
  const std::string owner = util::QuoteLiteral(params.schema);
  const std::string like = util::QuoteLiteral(util::LikePrefixPattern(params.filter));
  const std::string sql =
      "SELECT OBJECT_NAME FROM ALL_OBJECTS WHERE OWNER = " + owner +
      " AND OBJECT_TYPE = 'PACKAGE' AND OBJECT_NAME LIKE " + like +
      " ESCAPE '\\' ORDER BY OBJECT_NAME";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, limit + 1, rows, error)) {
    return {};
  }
  nlohmann::json packages = nlohmann::json::array();
  bool truncated = rows.truncated;
  for (const auto& row : rows.rows) {
    if (row.empty()) {
      continue;
    }
    if (static_cast<int>(packages.size()) >= limit) {
      truncated = true;
      break;
    }
    packages.push_back({{"name", row[0]}, {"type", "package"}, {"schema", params.schema}});
  }
  nlohmann::json out{{"packages", packages}, {"objects", packages}};
  if (truncated) {
    out["truncated"] = true;
  }
  return out;
}

nlohmann::json CategoryCounts(session::Session& session, const ListParams& params, std::string& error) {
  if (params.schema.empty() || !util::IsSafeIdent(params.schema)) {
    error = "oracle: schema required";
    return {};
  }
  const std::string owner = util::QuoteLiteral(params.schema);
  auto count_one = [&](const std::string& sql, int& dest) -> bool {
    session::SqlRowsResult rows;
    if (!session::ExecStringRows(session, sql, 2, rows, error)) {
      return false;
    }
    if (!rows.rows.empty() && !rows.rows[0].empty()) {
      try {
        dest = std::stoi(rows.rows[0][0]);
      } catch (...) {
        dest = 0;
      }
    }
    return true;
  };

  int tables = 0;
  int views = 0;
  int procedures = 0;
  int functions = 0;
  int sequences = 0;
  int packages = 0;
  int synonyms = 0;
  int triggers = 0;

  if (!count_one("SELECT COUNT(*) FROM ALL_TABLES WHERE OWNER = " + owner, tables) ||
      !count_one("SELECT COUNT(*) FROM ALL_VIEWS WHERE OWNER = " + owner, views) ||
      !count_one("SELECT COUNT(*) FROM ALL_OBJECTS WHERE OWNER = " + owner +
                     " AND OBJECT_TYPE = 'PROCEDURE'",
                 procedures) ||
      !count_one("SELECT COUNT(*) FROM ALL_OBJECTS WHERE OWNER = " + owner +
                     " AND OBJECT_TYPE = 'FUNCTION'",
                 functions) ||
      !count_one("SELECT COUNT(*) FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER = " + owner, sequences) ||
      !count_one("SELECT COUNT(*) FROM ALL_OBJECTS WHERE OWNER = " + owner +
                     " AND OBJECT_TYPE = 'PACKAGE'",
                 packages) ||
      !count_one("SELECT COUNT(*) FROM ALL_OBJECTS WHERE OWNER = " + owner +
                     " AND OBJECT_TYPE = 'SYNONYM'",
                 synonyms) ||
      !count_one("SELECT COUNT(*) FROM ALL_OBJECTS WHERE OWNER = " + owner +
                     " AND OBJECT_TYPE = 'TRIGGER'",
                 triggers)) {
    return {};
  }

  return nlohmann::json{
      {"tables", tables},
      {"views", views},
      {"procedures", procedures},
      {"functions", functions},
      {"sequences", sequences},
      {"packages", packages},
      {"synonyms", synonyms},
      {"triggers", triggers},
  };
}

}  // namespace niuma::oracle::tree
