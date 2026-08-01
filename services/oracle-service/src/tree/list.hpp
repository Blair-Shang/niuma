#pragma once

#include "session/manager.hpp"

#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace niuma::oracle::tree {

struct ListParams {
  std::string schema;
  std::string filter;
  int limit = 500;
  bool exclude_system = true;
  std::vector<std::string> types;

  static ListParams FromJson(const nlohmann::json& j);
};

nlohmann::json ListSchemas(session::Session& session, const ListParams& params, std::string& error);
nlohmann::json ListTables(session::Session& session, const ListParams& params, std::string& error);
nlohmann::json ListRoutines(session::Session& session, const ListParams& params, std::string& error);
nlohmann::json ListSequences(session::Session& session, const ListParams& params, std::string& error);
nlohmann::json ListPackages(session::Session& session, const ListParams& params, std::string& error);
nlohmann::json CategoryCounts(session::Session& session, const ListParams& params, std::string& error);

}  // namespace niuma::oracle::tree
