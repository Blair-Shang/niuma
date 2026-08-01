#pragma once

#include <string>

namespace niuma::oracle::util {

// SQL 字符串字面量：单引号转义。
std::string QuoteLiteral(const std::string& value);

// LIKE 前缀：转义 \ % _ 后追加 %（ESCAPE '\'）。
std::string LikePrefixPattern(const std::string& prefix);

int ClampListLimit(int limit, int def = 500, int max = 5000);

}  // namespace niuma::oracle::util
