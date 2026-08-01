#include <niuma/serviceipc/frame.hpp>

#include <cstring>

namespace niuma::serviceipc {

bool TryReadFrame(std::string& buffer, std::string& payload, std::string& error) {
  error.clear();
  if (buffer.size() < 4) {
    return false;
  }
  std::uint32_t n = 0;
  std::memcpy(&n, buffer.data(), 4);
  if (n > kMaxFrameSize) {
    error = "serviceipc: frame exceeds max size";
    buffer.clear();
    return false;
  }
  if (buffer.size() < 4 + n) {
    return false;
  }
  payload.assign(buffer.data() + 4, n);
  buffer.erase(0, 4 + n);
  return true;
}

std::string EncodeFrame(std::string_view payload) {
  if (payload.size() > kMaxFrameSize) {
    return {};
  }
  std::string out;
  out.resize(4 + payload.size());
  const auto n = static_cast<std::uint32_t>(payload.size());
  std::memcpy(out.data(), &n, 4);
  if (!payload.empty()) {
    std::memcpy(out.data() + 4, payload.data(), payload.size());
  }
  return out;
}

}  // namespace niuma::serviceipc
