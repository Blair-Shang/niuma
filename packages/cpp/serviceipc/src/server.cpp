#include <niuma/serviceipc/server.hpp>

#include <niuma/serviceipc/frame.hpp>
#include <niuma/serviceipc/message.hpp>

#include <iostream>
#include <thread>

#ifdef NIUMA_SERVICEIPC_WIN
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cerrno>
#include <cstring>
#endif

namespace niuma::serviceipc {
namespace {

void HandleBufferedConnection(
    std::string& buffer,
    const std::function<bool(const char*, size_t)>& write_fn,
    const FrameHandler& handler,
    std::string& read_chunk) {
  buffer.append(read_chunk);
  for (;;) {
    std::string payload;
    std::string err;
    if (!TryReadFrame(buffer, payload, err)) {
      if (!err.empty()) {
        const auto fail = MakeFailResponse("", err);
        const auto frame = EncodeFrame(fail);
        write_fn(frame.data(), frame.size());
      }
      break;
    }
    const std::string resp = handler(payload);
    const auto body =
        resp.empty() ? MakeFailResponse("", "empty response") : resp;
    const auto frame = EncodeFrame(body);
    if (frame.empty() || !write_fn(frame.data(), frame.size())) {
      break;
    }
  }
}

#ifdef NIUMA_SERVICEIPC_WIN

std::wstring WidenPipeName(const std::string& address) {
  int n = MultiByteToWideChar(CP_UTF8, 0, address.c_str(), -1, nullptr, 0);
  std::wstring out(static_cast<size_t>(n), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, address.c_str(), -1, out.data(), n);
  if (!out.empty() && out.back() == L'\0') {
    out.pop_back();
  }
  return out;
}

bool WriteAll(HANDLE h, const char* data, size_t n) {
  size_t off = 0;
  while (off < n) {
    DWORD written = 0;
    if (!WriteFile(h, data + off, static_cast<DWORD>(n - off), &written, nullptr)) {
      return false;
    }
    off += written;
  }
  return true;
}

void ServeClient(HANDLE pipe, FrameHandler handler) {
  std::string buffer;
  char chunk[64 * 1024];
  for (;;) {
    DWORD read = 0;
    const BOOL ok = ReadFile(pipe, chunk, sizeof(chunk), &read, nullptr);
    if (!ok || read == 0) {
      break;
    }
    std::string piece(chunk, read);
    auto write_fn = [&](const char* data, size_t n) { return WriteAll(pipe, data, n); };
    HandleBufferedConnection(buffer, write_fn, handler, piece);
  }
  FlushFileBuffers(pipe);
  DisconnectNamedPipe(pipe);
  CloseHandle(pipe);
}

#endif

}  // namespace

Server::Server(std::string address, FrameHandler handler, std::string log_name)
    : address_(std::move(address)),
      handler_(std::move(handler)),
      log_name_(std::move(log_name)) {}

Server::~Server() { Stop(); }

void Server::Stop() { stopping_.store(true); }

#ifdef NIUMA_SERVICEIPC_WIN

int Server::Serve() {
  const auto pipe_name = WidenPipeName(address_);
  std::cerr << log_name_ << " listening on " << address_ << std::endl;

  while (!stopping_.load()) {
    HANDLE pipe = CreateNamedPipeW(
        pipe_name.c_str(),
        PIPE_ACCESS_DUPLEX,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
        PIPE_UNLIMITED_INSTANCES,
        1024 * 1024,
        1024 * 1024,
        0,
        nullptr);
    if (pipe == INVALID_HANDLE_VALUE) {
      std::cerr << log_name_ << ": CreateNamedPipe failed: " << GetLastError() << std::endl;
      return 1;
    }
    const BOOL connected =
        ConnectNamedPipe(pipe, nullptr) ? TRUE : (GetLastError() == ERROR_PIPE_CONNECTED);
    if (!connected) {
      CloseHandle(pipe);
      if (stopping_.load()) {
        break;
      }
      continue;
    }
    std::thread(ServeClient, pipe, handler_).detach();
  }
  return 0;
}

#else

int Server::Serve() {
  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    std::cerr << log_name_ << ": socket failed\n";
    return 1;
  }
  ::unlink(address_.c_str());
  sockaddr_un addr{};
  addr.sun_family = AF_UNIX;
  if (address_.size() >= sizeof(addr.sun_path)) {
    std::cerr << log_name_ << ": socket path too long\n";
    ::close(fd);
    return 1;
  }
  std::memcpy(addr.sun_path, address_.c_str(), address_.size() + 1);
  if (::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
    std::cerr << log_name_ << ": bind failed: " << std::strerror(errno) << std::endl;
    ::close(fd);
    return 1;
  }
  if (::listen(fd, 64) != 0) {
    std::cerr << log_name_ << ": listen failed\n";
    ::close(fd);
    return 1;
  }
  std::cerr << log_name_ << " listening on " << address_ << std::endl;

  while (!stopping_.load()) {
    const int client = ::accept(fd, nullptr, nullptr);
    if (client < 0) {
      if (stopping_.load()) {
        break;
      }
      continue;
    }
    std::thread([client, handler = handler_]() {
      std::string buffer;
      char chunk[64 * 1024];
      for (;;) {
        const ssize_t n = ::read(client, chunk, sizeof(chunk));
        if (n <= 0) {
          break;
        }
        std::string piece(chunk, static_cast<size_t>(n));
        auto write_fn = [client](const char* data, size_t len) {
          size_t off = 0;
          while (off < len) {
            const ssize_t w = ::write(client, data + off, len - off);
            if (w <= 0) {
              return false;
            }
            off += static_cast<size_t>(w);
          }
          return true;
        };
        HandleBufferedConnection(buffer, write_fn, handler, piece);
      }
      ::close(client);
    }).detach();
  }
  ::close(fd);
  ::unlink(address_.c_str());
  return 0;
}

#endif

}  // namespace niuma::serviceipc
