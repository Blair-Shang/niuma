#pragma once

#include "session/manager.hpp"
#include "session/query.hpp"

#include <nlohmann/json.hpp>
#include <string>

namespace niuma::oracle::session {

nlohmann::json ExplainQuery(Session& session, const QueryExecParams& params, std::string& error);

}  // namespace niuma::oracle::session
