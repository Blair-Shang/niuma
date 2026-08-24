#pragma once

#include "session/manager.hpp"

#include <nlohmann/json.hpp>
#include <string>

namespace niuma::oracle::meta {

struct RelationRef {
  std::string schema;
  std::string name;
  /** 可选提示：table | view；编辑视图时传入可避免误降级成表 DDL。 */
  std::string object_type;

  static RelationRef FromJson(const nlohmann::json& j);
};

nlohmann::json ListColumns(session::Session& session, const RelationRef& ref, std::string& error);
nlohmann::json ListIndexes(session::Session& session, const RelationRef& ref, std::string& error);
nlohmann::json GetPrimaryKey(session::Session& session, const RelationRef& ref, std::string& error);
nlohmann::json ListForeignKeys(session::Session& session, const RelationRef& ref, std::string& error);
nlohmann::json GetDDL(session::Session& session, const RelationRef& ref, std::string& error);

}  // namespace niuma::oracle::meta
