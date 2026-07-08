#include "core/runtime/service_manifest.h"
#include "util/runtime_paths.h"

namespace niuma {

bool ServiceManifestLoader::LoadFromDirectory(const std::string& manifests_dir) {
  (void)manifests_dir;
  ServiceManifest platform;
  platform.id = "com.niuma.platform";
  platform.name = "Platform Core";
#if defined(_WIN32)
  platform.executable = "services/bin/niuma-platform-core.exe";
  platform.transport = "named_pipe";
#else
  platform.executable = "services/bin/niuma-platform-core";
  platform.transport = "unix_socket";
#endif
  // 命名管道 + 4 字节小端长度前缀 + UTF-8 JSON（见 docs/11-platform-core.md）。
  // 与 Go platform-core (ipcAddress) 及 PlatformClient (kPipeName) 三处保持一致。
  platform.address = GetPlatformIpcAddress();
  platform.protocol = "length_prefixed_json";
  platform.startup = "always";
  manifests_[platform.id] = platform;
  return true;
}

const ServiceManifest* ServiceManifestLoader::Find(
    const std::string& service_id) const {
  const auto it = manifests_.find(service_id);
  return it != manifests_.end() ? &it->second : nullptr;
}

}  // namespace niuma
