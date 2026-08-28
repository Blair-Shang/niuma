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

/** 从错误文案推断稳定 errorCode（与 Go envelope.InferCode 常用子集对齐）。 */
std::string InferBridgeErrorCode(const std::string& error);

/**
 * 失败时交给 cefQuery onFailure 的 JSON 载荷。
 * 形状：{"v":1,"error":"...","errorCode":"...","traceId":"..."}。
 * 旧 Web 若把整段当 Error.message 仍可读；新 Web 解析 errorCode / traceId。
 */
std::string FormatBridgeFailureJson(const std::string& error,
                                    const std::string& error_code,
                                    const std::string& trace_id);

}  // namespace niuma
