#include "bridge/stream_proxy.h"
#include "ipc/platform_client.h"

namespace niuma {

StreamProxy& StreamProxy::Instance() {
  static StreamProxy instance;
  return instance;
}

void StreamProxy::Cancel(const std::string& stream_id) {
  PlatformClient::CloseStream(stream_id);
}

void StreamProxy::CancelAll() {
  PlatformClient::CloseAllStreams();
}

}  // namespace niuma
