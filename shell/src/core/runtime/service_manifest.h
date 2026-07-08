#pragma once

#include <string>
#include <unordered_map>

namespace niuma {

struct ServiceManifest {
  std::string id;
  std::string name;
  std::string executable;
  std::string transport;
  std::string address;
  std::string protocol;
  std::string startup;
};

class ServiceManifestLoader {
 public:
  bool LoadFromDirectory(const std::string& manifests_dir);
  const ServiceManifest* Find(const std::string& service_id) const;
  const std::unordered_map<std::string, ServiceManifest>& All() const {
    return manifests_;
  }

 private:
  std::unordered_map<std::string, ServiceManifest> manifests_;
};

}  // namespace niuma
