#include "util/ident.hpp"

#include <cctype>

namespace niuma::oracle::util {

std::string QuoteIdent(const std::string& ident) {
  if (ident.empty()) {
    return {};
  }
  std::string out;
  out.reserve(ident.size() + 2);
  out.push_back('"');
  for (unsigned char c : ident) {
    if (c == '"') {
      out.push_back('"');
      out.push_back('"');
    } else {
      out.push_back(static_cast<char>(c));
    }
  }
  out.push_back('"');
  return out;
}

bool IsSafeIdent(const std::string& ident) {
  if (ident.empty() || ident.size() > 128) {
    return false;
  }
  for (unsigned char c : ident) {
    if (std::isalnum(c) || c == '_' || c == '$' || c == '#' || c == '.') {
      continue;
    }
    // 允许非 ASCII（中文等标识符），禁止控制字符
    if (c >= 0x80) {
      continue;
    }
    return false;
  }
  return true;
}

}  // namespace niuma::oracle::util
