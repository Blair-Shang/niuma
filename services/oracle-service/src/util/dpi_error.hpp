#pragma once

#include <dpi.h>
#include <string>

namespace niuma::oracle::util {

/**
 * 读取 ODPI 最近错误并整理为 UTF-8 前缀消息（"oracle: ..."）。
 * messageLength 优先于 C 字符串长度，避免截断。
 */
std::string FormatDpiError(dpiContext* ctx, const char* fallback = "oracle: ODPI error");

/** 将已取出的 dpiErrorInfo 格式化为 "oracle: ..."。 */
std::string FormatDpiErrorInfo(const dpiErrorInfo& info, const char* fallback = "oracle: ODPI error");

}  // namespace niuma::oracle::util
