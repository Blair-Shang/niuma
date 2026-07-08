#pragma once

#include <cstddef>
#include <string>

namespace niuma {

class StreamProxy {
 public:
  static constexpr size_t kChunkSize = 64 * 1024;

  static StreamProxy& Instance();

  void Cancel(const std::string& stream_id);
  void CancelAll();

 private:
  StreamProxy() = default;
};

}  // namespace niuma
