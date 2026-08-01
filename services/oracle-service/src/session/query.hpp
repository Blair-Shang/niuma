#pragma once

#include "session/manager.hpp"

#include <nlohmann/json.hpp>
#include <string>

namespace niuma::oracle::session {

struct QueryExecParams {
  std::string session_id;
  std::string schema;
  std::string sql;
  int limit = 1000;
  int timeout_ms = 0;
  std::string request_id;

  static QueryExecParams FromJson(const nlohmann::json& j);
};

nlohmann::json ExecQuery(Session& session, const QueryExecParams& params, std::string& error);
nlohmann::json FetchMore(Session& session, const std::string& result_set_id, int limit, std::string& error);
bool CloseResultSet(Session& session, const std::string& result_set_id);
bool CancelQuery(Session& session, const std::string& request_id);

}  // namespace niuma::oracle::session
