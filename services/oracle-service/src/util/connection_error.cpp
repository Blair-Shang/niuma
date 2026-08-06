#include "util/connection_error.hpp"

#include <cctype>
#include <string>

namespace niuma::oracle::util {
namespace {

std::string ToLowerAscii(std::string_view s) {
  std::string out;
  out.reserve(s.size());
  for (unsigned char c : s) {
    out.push_back(static_cast<char>(std::tolower(c)));
  }
  return out;
}

}  // namespace

bool IsConnectionLost(std::string_view err) {
  if (err.empty()) {
    return false;
  }
  const std::string lower = ToLowerAscii(err);
  static const char* kNeedles[] = {
      "dpi-1080",
      "dpi-1010",
      "ora-03113",
      "ora-03114",
      "ora-03135",
      "ora-00028",
      "ora-01012",
      "ora-25408",
      "connection was closed",
      "end-of-file on communication channel",
      "not connected to oracle",
      "session closed, please reconnect",
  };
  for (const char* n : kNeedles) {
    if (lower.find(n) != std::string::npos) {
      return true;
    }
  }
  return false;
}

}  // namespace niuma::oracle::util
