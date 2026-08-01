#include <niuma/serviceipc/event.hpp>
#include <niuma/serviceipc/frame.hpp>

#include <string>

#if defined(NIUMA_SERVICEIPC_WIN)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cstring>
#include <cstdlib>
#endif

namespace niuma::serviceipc {

std::string EventIngestAddress() {
#if defined(NIUMA_SERVICEIPC_WIN)
  return R"(\\.\pipe\niuma.platform.eventin)";
#else
  const char* tmp = std::getenv("TMPDIR");
  if (tmp == nullptr || tmp[0] == '\0') {
    tmp = "/tmp";
  }
  return std::string(tmp) + "/niuma.platform.eventin.sock";
#endif
}

bool PublishEvent(std::string_view json_payload) {
  if (json_payload.empty()) {
    return false;
  }
  const std::string frame = EncodeFrame(json_payload);
  if (frame.empty()) {
    return false;
  }

#if defined(NIUMA_SERVICEIPC_WIN)
  const std::string addr = EventIngestAddress();
  HANDLE pipe = CreateFileA(addr.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
  if (pipe == INVALID_HANDLE_VALUE) {
    // 管道忙时短暂重试
    if (!WaitNamedPipeA(addr.c_str(), 2000)) {
      return false;
    }
    pipe = CreateFileA(addr.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
    if (pipe == INVALID_HANDLE_VALUE) {
      return false;
    }
  }
  DWORD written = 0;
  const BOOL ok =
      WriteFile(pipe, frame.data(), static_cast<DWORD>(frame.size()), &written, nullptr);
  CloseHandle(pipe);
  return ok && written == frame.size();
#else
  const std::string addr = EventIngestAddress();
  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    return false;
  }
  sockaddr_un sa{};
  sa.sun_family = AF_UNIX;
  if (addr.size() >= sizeof(sa.sun_path)) {
    ::close(fd);
    return false;
  }
  std::memcpy(sa.sun_path, addr.c_str(), addr.size() + 1);
  if (::connect(fd, reinterpret_cast<sockaddr*>(&sa), sizeof(sa)) != 0) {
    ::close(fd);
    return false;
  }
  size_t off = 0;
  while (off < frame.size()) {
    const ssize_t n = ::write(fd, frame.data() + off, frame.size() - off);
    if (n <= 0) {
      ::close(fd);
      return false;
    }
    off += static_cast<size_t>(n);
  }
  ::close(fd);
  return true;
#endif
}

}  // namespace niuma::serviceipc
