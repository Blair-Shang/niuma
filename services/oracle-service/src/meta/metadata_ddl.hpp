#pragma once

#include "session/manager.hpp"

#include <string>

namespace niuma::oracle::meta {

// 通过 DBMS_METADATA.GET_DDL 获取完整 DDL（CLOB 以 LOB 方式读取，避免 4K 截断）。
bool FetchDbmsMetadataDdl(session::Session& session, const std::string& object_type,
                          const std::string& schema, const std::string& name, std::string& ddl,
                          std::string& error);

// 解析 ALL_OBJECTS 中的精确 OWNER + OBJECT_NAME（兼容大小写）。
bool ResolveDictionaryObject(session::Session& session, const std::string& schema,
                             const std::string& name, const std::string& object_type,
                             std::string& out_owner, std::string& out_name, std::string& error);

// 解析 ALL_OBJECTS 中的精确对象名（大小写）。
std::string ResolveDictionaryObjectName(session::Session& session, const std::string& schema,
                                        const std::string& name, const std::string& object_type,
                                        std::string& error);

}  // namespace niuma::oracle::meta
