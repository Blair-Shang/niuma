#pragma once

#include "session/manager.hpp"

#include <nlohmann/json.hpp>
#include <string>

namespace niuma::oracle::catalog {

struct ListParams {
  std::string schema;
  std::string table;
  std::string prefix;
  int limit = 200;

  static ListParams FromJson(const nlohmann::json& j);
};

nlohmann::json ListSchemas(session::Session& session, const ListParams& params, std::string& error);
nlohmann::json ListTables(session::Session& session, const ListParams& params, std::string& error);
nlohmann::json ListColumns(session::Session& session, const ListParams& params, std::string& error);

}  // namespace niuma::oracle::catalog
