#pragma once

#include <cstdint>
#include <string>
#include <string_view>

namespace niuma::serviceipc {

/** 单帧 JSON 载荷上限，与 packages/go/serviceipc 对齐。 */
inline constexpr std::uint32_t kMaxFrameSize = 16u << 20;  // 16 MiB

/**
 * 从字节流缓冲中尝试拆出一帧。
 * @return true 已拆出一帧并写入 payload，且已从 buffer 消费对应字节；
 *         false 数据不足（error 空）或致命错误（error 非空，buffer 可能被清空）。
 */
bool TryReadFrame(std::string& buffer, std::string& payload, std::string& error);

/** 编码一帧：4 字节小端长度 + UTF-8 JSON。超限返回空串。 */
std::string EncodeFrame(std::string_view payload);

}  // namespace niuma::serviceipc
