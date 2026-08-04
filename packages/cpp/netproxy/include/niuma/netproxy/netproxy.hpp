#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <thread>

namespace niuma::netproxy {

// 与 Web connection_options.proxy / packages/go/netproxy.Options /
// packages/rust/niuma-netproxy::Options 对齐。
struct Options {
  std::string type;  // none | http | socks4 | socks4a | socks5
  std::string host;
  int port = 0;
  std::string username;
  std::string password;

  bool Enabled() const;
  int PortOrDefault() const;
};

// 本地 127.0.0.1 转发句柄：析构时停止监听。
// 适用：客户端库无法注入自定义 dialer（如 ODPI），改为连本地端口，由本模块经代理转发。
class RelayGuard {
 public:
  RelayGuard() = default;
  ~RelayGuard();

  RelayGuard(const RelayGuard&) = delete;
  RelayGuard& operator=(const RelayGuard&) = delete;
  RelayGuard(RelayGuard&&) = delete;
  RelayGuard& operator=(RelayGuard&&) = delete;

  void Stop();

 private:
  friend std::unique_ptr<RelayGuard> StartRelay(const Options& proxy, const std::string& target_host,
                                                uint16_t target_port, std::string& local_host,
                                                uint16_t& local_port, std::string& error);

  std::atomic<bool> stop_{false};
#ifdef NIUMA_NETPROXY_WIN
  uintptr_t listen_fd_ = ~static_cast<uintptr_t>(0);  // INVALID_SOCKET
#else
  int listen_fd_ = -1;
#endif
  std::thread accept_thread_;
};

// 在 127.0.0.1 上监听随机端口，每条入站连接经 proxy 转发到 target。
// 成功时写入 local_host/local_port 并返回 guard；失败时 error 非空且返回 nullptr。
std::unique_ptr<RelayGuard> StartRelay(const Options& proxy, const std::string& target_host, uint16_t target_port,
                                       std::string& local_host, uint16_t& local_port, std::string& error);

}  // namespace niuma::netproxy
