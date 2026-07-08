#pragma once

#include <string>
#include <functional>
#include <optional>
#include <utility>

namespace niuma {

struct BridgeRequest {
  std::string method;
  std::string params;
  std::string id;
  /** 发起 cefQuery 的 CEF 窗口 id；params 未带 windowId 时用于解析当前窗口 */
  int caller_window_id = 0;
};

struct BridgeResponse {
  std::string id;
  bool ok = true;
  std::string result;
  std::string error;
};

struct BridgeEvent {
  std::string type;
  std::string data;
};

using BridgeCallback = std::function<void(BridgeResponse)>;

std::string GetRuntimeDir();
std::string GetInstallDir();
std::string GetWebResourcesPath();

std::optional<std::pair<std::string, std::string>> ParseMethod(
    const std::string& method);

}  // namespace niuma
