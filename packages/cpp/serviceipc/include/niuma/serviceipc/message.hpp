#pragma once

#include <string>
#include <string_view>

namespace niuma::serviceipc {

/**
 * 与 Go serviceipc handler 信封对齐的辅助构造（不强制解析库）。
 * 形状：{"id","ok","error?","result"}，其中 result 为嵌套 JSON 字符串。
 */
std::string MakeOkResponse(std::string_view id, std::string_view result_json);
std::string MakeFailResponse(std::string_view id, std::string_view error);

/** 对 JSON 字符串内容做最小转义（用于写入 error 字段）。 */
std::string EscapeJsonString(std::string_view s);

}  // namespace niuma::serviceipc
