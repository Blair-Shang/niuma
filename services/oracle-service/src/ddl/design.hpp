#pragma once

#include "session/manager.hpp"

#include <nlohmann/json.hpp>
#include <string>

namespace niuma::oracle::ddl {

nlohmann::json DesignPreview(const nlohmann::json& params, std::string& error);
nlohmann::json DesignApply(session::Session& session, const nlohmann::json& params, std::string& error);
nlohmann::json CreateTablePreview(const nlohmann::json& params, std::string& error);
nlohmann::json CreateTable(session::Session& session, const nlohmann::json& params, std::string& error);

}  // namespace niuma::oracle::ddl
