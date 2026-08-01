#include "util/sql_literal.hpp"

namespace niuma::oracle::util {

std::string QuoteLiteral(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 2);
  out.push_back('\'');
  for (char c : value) {
    if (c == '\'') {
      out.push_back('\'');
      out.push_back('\'');
    } else {
      out.push_back(c);
    }
  }
  out.push_back('\'');
  return out;
}

std::string LikePrefixPattern(const std::string& prefix) {
  std::string out;
  out.reserve(prefix.size() + 1);
  for (char c : prefix) {
    if (c == '\\' || c == '%' || c == '_') {
      out.push_back('\\');
    }
    out.push_back(c);
  }
  out.push_back('%');
  return out;
}

int ClampListLimit(int limit, int def, int max) {
  if (limit <= 0) {
    return def;
  }
  return limit > max ? max : limit;
}

}  // namespace niuma::oracle::util
