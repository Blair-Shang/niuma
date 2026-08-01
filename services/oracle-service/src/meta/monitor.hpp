#pragma once

#include "session/manager.hpp"

#include <nlohmann/json.hpp>
#include <cstdint>
#include <string>

namespace niuma::oracle::meta {

nlohmann::json ListProcesslist(session::Session& session, std::string& error);
nlohmann::json KillSession(session::Session& session, int64_t sid, int64_t serial, bool query_only,
                           std::string& error);
nlohmann::json InstanceOverview(session::Session& session, std::string& error);
nlohmann::json ListLocks(session::Session& session, int limit, std::string& error);

}  // namespace niuma::oracle::meta
