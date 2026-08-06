#pragma once

// NiuMa 桌面子进程落盘日志（对标 packages/go/logutil、packages/rust/niuma-logutil）。
// 目录优先级：NIUMMA_LOG_DIR > NIUMMA_LOG_ROOT > 仓库根 logs/。

#include <cstdint>
#include <initializer_list>
#include <string>
#include <string_view>
#include <type_traits>
#include <vector>

namespace niuma::logutil {

/// 单日志文件上限（100 MiB）。
inline constexpr std::uint64_t kMaxFileBytes = 100ull << 20;

struct Attr {
  std::string key;
  std::string value;

  Attr(std::string_view k, std::string_view v);
  Attr(std::string_view k, const char* v);
  Attr(std::string_view k, bool v);

  template <class T, std::enable_if_t<std::is_integral_v<T> && !std::is_same_v<std::remove_cv_t<T>, bool>, int> = 0>
  Attr(std::string_view k, T v) : key(k), value(std::to_string(v)) {}
};

/// 将默认日志输出重定向到 <logDir>/<serviceName>.log。
/// 无法解析 logDir 时回退 stderr（便于纯终端调试）。
bool Init(std::string_view service_name);

void Info(std::string_view msg, std::initializer_list<Attr> attrs = {});
void Warn(std::string_view msg, std::initializer_list<Attr> attrs = {});
void Error(std::string_view msg, std::initializer_list<Attr> attrs = {});

void Info(std::string_view msg, const std::vector<Attr>& attrs);
void Warn(std::string_view msg, const std::vector<Attr>& attrs);
void Error(std::string_view msg, const std::vector<Attr>& attrs);

}  // namespace niuma::logutil
