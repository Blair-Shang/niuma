#pragma once

#include <atomic>
#include <chrono>
#include <random>
#include <string>

namespace niuma::oracle::util {

inline std::string NextId(const char* prefix = "ora") {
  static std::atomic<std::uint64_t> seq{0};
  const auto now = std::chrono::steady_clock::now().time_since_epoch().count();
  return std::string(prefix) + "-" + std::to_string(now) + "-" + std::to_string(seq.fetch_add(1));
}

}  // namespace niuma::oracle::util
