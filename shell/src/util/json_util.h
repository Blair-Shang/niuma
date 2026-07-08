#pragma once

#include <string>

namespace niuma {

/** 从 JSON 对象字符串中提取字符串字段（极简解析，无第三方依赖）。 */
std::string JsonGetString(const std::string& json, const char* key);

/** 提取整数字段；不存在或非法时返回 default_value。 */
int JsonGetInt(const std::string& json, const char* key, int default_value);

/** 提取布尔字段；不存在或非法时返回 default_value。 */
bool JsonGetBool(const std::string& json, const char* key, bool default_value);

/** 将 UTF-8 字符串编码为 JSON 字符串字面量（含引号）。 */
std::string JsonQuoteString(const std::string& value);

}  // namespace niuma
