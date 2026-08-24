#pragma once

#include "session/manager.hpp"

#include <nlohmann/json.hpp>
#include <string>

namespace niuma::oracle::meta {

struct RoutineRef {
  std::string schema;
  std::string name;
  std::string kind;  // procedure | function

  static RoutineRef FromJson(const nlohmann::json& j);
};

struct PackageRef {
  std::string schema;
  std::string name;
  std::string part;  // spec | body | both

  static PackageRef FromJson(const nlohmann::json& j);
};

nlohmann::json GetRoutineSource(session::Session& session, const RoutineRef& ref, std::string& error);
nlohmann::json GetPackageSource(session::Session& session, const PackageRef& ref, std::string& error);
/** ALL_ARGUMENTS 形参列表（含 OUT/IN OUT）；函数返回值放 returnType。 */
nlohmann::json ListRoutineParameters(session::Session& session, const RoutineRef& ref, std::string& error);

}  // namespace niuma::oracle::meta
