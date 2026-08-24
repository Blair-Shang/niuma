#include "meta/column_type.hpp"

#include <cctype>

namespace niuma::oracle::meta {

std::string TrimOracleDefault(std::string value) {
  while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) {
    value.erase(value.begin());
  }
  while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) {
    value.pop_back();
  }
  std::string collapsed;
  collapsed.reserve(value.size());
  bool pending_space = false;
  for (char ch : value) {
    if (std::isspace(static_cast<unsigned char>(ch))) {
      pending_space = !collapsed.empty();
      continue;
    }
    if (pending_space) {
      collapsed.push_back(' ');
      pending_space = false;
    }
    collapsed.push_back(ch);
  }
  value = std::move(collapsed);
  if (value.size() >= 8 && (value.compare(0, 7, "DEFAULT") == 0 || value.compare(0, 7, "default") == 0) &&
      std::isspace(static_cast<unsigned char>(value[7]))) {
    value.erase(0, 7);
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) {
      value.erase(value.begin());
    }
  }
  return value;
}

}  // namespace niuma::oracle::meta
