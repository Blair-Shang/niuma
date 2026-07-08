#include "ipc/platform_client.h"

#include "util/json_util.h"
#include "util/runtime_paths.h"

#include <functional>
#include <cstdint>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <utility>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#endif

#if NIUMMA_WITH_CEF
#include "include/base/cef_callback.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_closure_task.h"
#endif

namespace niuma {
namespace {

void PostToUi(std::function<void()> task);

#if defined(_WIN32)

/// 命名管道地址；必须与 Go platform-core 及 service manifest 保持一致。
constexpr wchar_t kPipeName[] = L"\\\\.\\pipe\\niuma.platform";
/// Shell 订阅 Platform 推送事件的命名管道（与 platform eventhub 一致）。
constexpr wchar_t kEventPipeName[] = L"\\\\.\\pipe\\niuma.platform.events";
/// 连接尝试次数（覆盖「刚 spawn、监听器尚未就绪」的窗口期）。
constexpr DWORD kConnectAttempts = 10;
/// 所有管道实例繁忙时等待空闲的超时（毫秒）。
constexpr DWORD kWaitPipeTimeoutMs = 2000;
/// 每次连接失败后的退避（毫秒）。
constexpr DWORD kRetrySleepMs = 150;
/// 单帧上限，与 Go 端 protocol.MaxFrameSize 对齐，防止异常长度触发超大分配。
constexpr uint32_t kMaxFrameBytes = 16u * 1024u * 1024u;
/// 长度前缀字节数（uint32 小端）。
constexpr DWORD kHeaderBytes = 4;

/// @brief HANDLE 的 RAII 封装：Move-only，析构时 CloseHandle。
class ScopedHandle {
 public:
  ScopedHandle() = default;
  explicit ScopedHandle(HANDLE handle) : handle_(handle) {}
  ScopedHandle(const ScopedHandle&) = delete;
  ScopedHandle& operator=(const ScopedHandle&) = delete;
  ~ScopedHandle() { Reset(); }

  bool Valid() const {
    return handle_ != INVALID_HANDLE_VALUE && handle_ != nullptr;
  }
  HANDLE Get() const { return handle_; }

  void Reset() {
    if (Valid()) {
      CloseHandle(handle_);
    }
    handle_ = INVALID_HANDLE_VALUE;
  }

 private:
  HANDLE handle_ = INVALID_HANDLE_VALUE;
};

/// @brief 向管道写满 len 字节（WriteFile 可能分多次写完）。
bool WriteAll(HANDLE pipe, const void* data, DWORD len) {
  const char* cursor = static_cast<const char*>(data);
  DWORD total = 0;
  while (total < len) {
    DWORD written = 0;
    if (!WriteFile(pipe, cursor + total, len - total, &written, nullptr) ||
        written == 0) {
      return false;
    }
    total += written;
  }
  return true;
}

/// @brief 从管道读满 len 字节（ReadFile 可能分多次到达）。
bool ReadAll(HANDLE pipe, void* buf, DWORD len) {
  char* cursor = static_cast<char*>(buf);
  DWORD total = 0;
  while (total < len) {
    DWORD read = 0;
    if (!ReadFile(pipe, cursor + total, len - total, &read, nullptr) ||
        read == 0) {
      return false;
    }
    total += read;
  }
  return true;
}

/// @brief 连接命名管道，处理 BUSY / 尚未就绪的重试；失败时写 error。
ScopedHandle ConnectPipe(const wchar_t* pipe_name, std::string& error) {
  for (DWORD attempt = 0; attempt < kConnectAttempts; ++attempt) {
    HANDLE handle = CreateFileW(pipe_name, GENERIC_READ | GENERIC_WRITE, 0,
                                nullptr, OPEN_EXISTING, 0, nullptr);
    if (handle != INVALID_HANDLE_VALUE) {
      return ScopedHandle(handle);
    }

    const DWORD err = GetLastError();
    if (err == ERROR_PIPE_BUSY) {
      // 所有实例繁忙：等待一个空闲后重试。
      WaitNamedPipeW(pipe_name, kWaitPipeTimeoutMs);
      continue;
    }
    if (err == ERROR_FILE_NOT_FOUND) {
      // 进程刚 spawn、监听器尚未建立：短暂退避后重试。
      Sleep(kRetrySleepMs);
      continue;
    }
    error = "connect failed (win32 " + std::to_string(err) + ")";
    return ScopedHandle();
  }
  error = "not reachable after retries";
  return ScopedHandle();
}

/// @brief 读取一帧响应/事件载荷。
bool ReadFrame(HANDLE pipe, std::string& response, std::string& error) {
  unsigned char resp_header[kHeaderBytes];
  if (!ReadAll(pipe, resp_header, kHeaderBytes)) {
    error = "read header failed";
    return false;
  }
  const uint32_t rn = static_cast<uint32_t>(resp_header[0]) |
                      (static_cast<uint32_t>(resp_header[1]) << 8) |
                      (static_cast<uint32_t>(resp_header[2]) << 16) |
                      (static_cast<uint32_t>(resp_header[3]) << 24);
  if (rn > kMaxFrameBytes) {
    error = "response too large";
    return false;
  }

  response.resize(rn);
  if (rn > 0 && !ReadAll(pipe, &response[0], rn)) {
    error = "read payload failed";
    return false;
  }
  return true;
}

/// @brief 单次请求-响应：连接 → 发送成帧请求 → 读取成帧响应。
bool SendRecv(const std::string& request, std::string& response,
              std::string& error) {
  ScopedHandle pipe = ConnectPipe(kPipeName, error);
  if (!pipe.Valid()) {
    return false;
  }

  const uint32_t n = static_cast<uint32_t>(request.size());
  unsigned char header[kHeaderBytes] = {
      static_cast<unsigned char>(n & 0xFF),
      static_cast<unsigned char>((n >> 8) & 0xFF),
      static_cast<unsigned char>((n >> 16) & 0xFF),
      static_cast<unsigned char>((n >> 24) & 0xFF)};
  if (!WriteAll(pipe.Get(), header, kHeaderBytes) ||
      (n > 0 && !WriteAll(pipe.Get(), request.data(), n))) {
    error = "write failed";
    return false;
  }

  return ReadFrame(pipe.Get(), response, error);
}

std::atomic<bool> g_event_listener_stop{false};
std::atomic<bool> g_event_listener_running{false};

void EventListenerLoop(PlatformEventCallback callback) {
  while (!g_event_listener_stop.load()) {
    std::string error;
    ScopedHandle pipe = ConnectPipe(kEventPipeName, error);
    if (!pipe.Valid()) {
      Sleep(500);
      continue;
    }
    while (!g_event_listener_stop.load()) {
      std::string payload;
      if (!ReadFrame(pipe.Get(), payload, error)) {
        break;
      }
      if (!payload.empty()) {
        PostToUi([callback, payload]() { callback(payload); });
      }
    }
  }
  g_event_listener_running.store(false);
}

#endif  // _WIN32

#if !defined(_WIN32)

constexpr uint32_t kMaxFrameBytes = 16u * 1024u * 1024u;
constexpr size_t kHeaderBytes = 4;
constexpr int kConnectAttempts = 10;
constexpr auto kRetrySleep = std::chrono::milliseconds(150);

bool WriteAll(int fd, const void* data, size_t len) {
  const char* cursor = static_cast<const char*>(data);
  size_t total = 0;
  while (total < len) {
    const ssize_t written = write(fd, cursor + total, len - total);
    if (written <= 0) {
      return false;
    }
    total += static_cast<size_t>(written);
  }
  return true;
}

bool ReadAll(int fd, void* buf, size_t len) {
  char* cursor = static_cast<char*>(buf);
  size_t total = 0;
  while (total < len) {
    const ssize_t read_n = read(fd, cursor + total, len - total);
    if (read_n <= 0) {
      return false;
    }
    total += static_cast<size_t>(read_n);
  }
  return true;
}

int ConnectUnixSocket(const std::string& path, std::string& error) {
  for (int attempt = 0; attempt < kConnectAttempts; ++attempt) {
    const int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
      error = "socket create failed";
      return -1;
    }

    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    if (path.size() >= sizeof(addr.sun_path)) {
      close(fd);
      error = "unix socket path too long";
      return -1;
    }
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", path.c_str());
    if (connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0) {
      return fd;
    }

    close(fd);
    std::this_thread::sleep_for(kRetrySleep);
  }
  error = "not reachable after retries";
  return -1;
}

bool ReadFrame(int fd, std::string& response, std::string& error) {
  unsigned char resp_header[kHeaderBytes];
  if (!ReadAll(fd, resp_header, kHeaderBytes)) {
    error = "read header failed";
    return false;
  }
  const uint32_t rn = static_cast<uint32_t>(resp_header[0]) |
                      (static_cast<uint32_t>(resp_header[1]) << 8) |
                      (static_cast<uint32_t>(resp_header[2]) << 16) |
                      (static_cast<uint32_t>(resp_header[3]) << 24);
  if (rn > kMaxFrameBytes) {
    error = "response too large";
    return false;
  }
  response.resize(rn);
  if (rn > 0 && !ReadAll(fd, &response[0], rn)) {
    error = "read payload failed";
    return false;
  }
  return true;
}

bool SendRecv(const std::string& request, std::string& response, std::string& error) {
  const int fd = ConnectUnixSocket(GetPlatformIpcAddress(), error);
  if (fd < 0) {
    return false;
  }

  const uint32_t n = static_cast<uint32_t>(request.size());
  unsigned char header[kHeaderBytes] = {
      static_cast<unsigned char>(n & 0xFF),
      static_cast<unsigned char>((n >> 8) & 0xFF),
      static_cast<unsigned char>((n >> 16) & 0xFF),
      static_cast<unsigned char>((n >> 24) & 0xFF)};
  const bool ok = WriteAll(fd, header, kHeaderBytes) &&
                  (n == 0 || WriteAll(fd, request.data(), n)) &&
                  ReadFrame(fd, response, error);
  close(fd);
  if (!ok && error.empty()) {
    error = "socket io failed";
  }
  return ok;
}

std::atomic<bool> g_event_listener_stop{false};
std::atomic<bool> g_event_listener_running{false};

void EventListenerLoop(PlatformEventCallback callback) {
  while (!g_event_listener_stop.load()) {
    std::string error;
    const int fd = ConnectUnixSocket(GetPlatformEventAddress(), error);
    if (fd < 0) {
      std::this_thread::sleep_for(std::chrono::milliseconds(500));
      continue;
    }
    while (!g_event_listener_stop.load()) {
      std::string payload;
      if (!ReadFrame(fd, payload, error)) {
        break;
      }
      if (!payload.empty()) {
        PostToUi([callback, payload]() { callback(payload); });
      }
    }
    close(fd);
  }
  g_event_listener_running.store(false);
}

#endif  // !_WIN32

/// @brief 在 CEF UI 线程执行 task；已在 UI 线程或无 CEF 时直接执行。
void PostToUi(std::function<void()> task) {
#if NIUMMA_WITH_CEF
  if (!CefCurrentlyOn(TID_UI)) {
    CefPostTask(TID_UI, base::BindOnce([](std::function<void()> fn) { fn(); },
                                       std::move(task)));
    return;
  }
#endif
  task();
}

}  // namespace

void PlatformClient::Invoke(const std::string& service_id,
                            const std::string& action,
                            const std::string& params_json,
                            PlatformCallback callback) {
  (void)service_id;
  (void)action;
  // params_json 为完整原始请求 JSON，原样发送。在独立线程做阻塞 IO，避免占用
  // CEF UI 线程；线程不捕获 this，仅持有请求副本与 callback，可安全 detach。
  std::thread worker([request = params_json,
                      callback = std::move(callback)]() mutable {
    std::string response;
    std::string io_error;
    const bool io_ok = SendRecv(request, response, io_error);

    bool ok = false;
    std::string data;
    std::string err;
    if (!io_ok) {
      err = "platform unavailable: " + io_error;
    } else {
      ok = JsonGetBool(response, "ok", false);
      data = JsonGetString(response, "result");
      err = JsonGetString(response, "error");
      if (!ok && err.empty()) {
        err = "platform error";
      }
    }

    PostToUi([cb = std::move(callback), ok, data = std::move(data),
              err = std::move(err)]() { cb(ok, data, err); });
  });
  worker.detach();
}

void PlatformClient::ShutdownAll() {
  StopEventListener();
}

void PlatformClient::StartEventListener(PlatformEventCallback callback) {
  if (g_event_listener_running.exchange(true)) {
    return;
  }
  g_event_listener_stop.store(false);
  std::thread(EventListenerLoop, std::move(callback)).detach();
}

void PlatformClient::StopEventListener() {
  g_event_listener_stop.store(true);
}

}  // namespace niuma
