#include "bridge/stream_proxy.h"

namespace niuma {

StreamProxy& StreamProxy::Instance() {
  static StreamProxy instance;
  return instance;
}

void StreamProxy::Cancel(const std::string& stream_id) { (void)stream_id; }

void StreamProxy::CancelAll() {}

}  // namespace niuma
