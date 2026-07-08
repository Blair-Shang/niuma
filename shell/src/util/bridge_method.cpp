#include "niuma/types.h"

namespace niuma {

std::optional<std::pair<std::string, std::string>> ParseMethod(
    const std::string& method) {
  const auto pos = method.rfind('.');
  if (pos == std::string::npos || pos == 0 || pos + 1 >= method.size()) {
    return std::nullopt;
  }
  return std::make_pair(method.substr(0, pos), method.substr(pos + 1));
}

}  // namespace niuma
