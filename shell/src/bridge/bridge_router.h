#pragma once

#include "niuma/types.h"

#include <memory>

namespace niuma {

class PlatformClient;

/** 方法路由：解析 service.action、确保进程在跑、透传至 PlatformClient。不做鉴权。 */
class BridgeRouter {
 public:
  BridgeRouter();
  ~BridgeRouter();

  void Dispatch(const BridgeRequest& req, BridgeCallback callback);

 private:
  std::unique_ptr<PlatformClient> platform_client_;
};

}  // namespace niuma
