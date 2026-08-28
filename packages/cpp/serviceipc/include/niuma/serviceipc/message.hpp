#pragma once

#include <string>
#include <string_view>

namespace niuma::serviceipc {

/**
 * 与 Go serviceipc/envelope 对齐的辅助构造（不强制解析库）。
 * 形状：{"v":1,"id","ok","error?","errorCode?","traceId?","result"}，
 * 其中 result 为嵌套 JSON 字符串；error 必须是字符串。
 */
std::string MakeOkResponse(std::string_view id, std::string_view result_json);
std::string MakeFailResponse(std::string_view id, std::string_view error);
std::string MakeFailResponse(std::string_view id, std::string_view error,
                             std::string_view error_code);

/** 从错误文案推断稳定 errorCode（与 Go envelope.InferCode 对齐的常用子集）。 */
std::string InferErrorCode(std::string_view error);

/** 对 JSON 字符串内容做最小转义（用于写入 error 字段）。 */
std::string EscapeJsonString(std::string_view s);

}  // namespace niuma::serviceipc
