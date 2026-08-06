#pragma once

#include <string>
#include <string_view>

namespace niuma::oracle::util {

/** 是否为合法 UTF-8（允许空串）。 */
bool IsValidUtf8(std::string_view s);

/**
 * 将任意字节串整理为可安全写入 JSON / 日志的 UTF-8。
 * - 已是 UTF-8：原样返回
 * - Windows 上优先尝试 CP936(GBK)→UTF-8
 * - 否则将非法字节替换为 U+FFFD
 */
std::string EnsureUtf8(std::string_view s);

}  // namespace niuma::oracle::util
