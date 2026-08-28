#pragma once

#include <filesystem>
#include <string>

namespace niuma {

/** 由 UTF-8 字节串构造 path。C++20 libc++ 已弃用 filesystem::u8path。 */
inline std::filesystem::path Utf8Path(const std::string& utf8) {
#if defined(__cpp_char8_t)
  return std::filesystem::path(std::u8string(
      reinterpret_cast<const char8_t*>(utf8.data()), utf8.size()));
#else
  return std::filesystem::u8path(utf8);
#endif
}

}  // namespace niuma
