#include "protocol/path_resolver.h"
#include "niuma/types.h"
#include "util/runtime_paths.h"

namespace niuma {

std::string ResolveAppResourcePath(const std::string& url_path) {
  static constexpr char kPluginsPrefix[] = "/plugins/";

  if (url_path.rfind(kPluginsPrefix, 0) == 0) {
    const std::string relative = url_path.substr(sizeof(kPluginsPrefix) - 1);
    if (relative.empty()) {
      return {};
    }
    return GetPluginsPath() + "/" + relative;
  }

  const auto base = GetWebResourcesPath();
  if (url_path.empty() || url_path == "/") {
    return base + "/index.html";
  }
  return base + url_path;
}

}  // namespace niuma
