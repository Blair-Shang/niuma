#pragma once

#include <string>

namespace niuma::oracle::meta {

// 默认排除的 Oracle 系统用户（树 / catalog）。
bool IsSystemSchema(const std::string& username);

}  // namespace niuma::oracle::meta
