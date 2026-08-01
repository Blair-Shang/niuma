#pragma once

#include <atomic>
#include <functional>
#include <string>

namespace niuma::serviceipc {

/** 处理一帧请求 JSON，返回完整响应 JSON（不含长度前缀）。 */
using FrameHandler = std::function<std::string(const std::string& request_json)>;

/**
 * Windows Named Pipe / Unix Domain Socket 上的 length-prefixed JSON 服务端。
 * 契约对齐 Go packages/go/serviceipc 与 Rust niuma-serviceipc。
 */
class Server {
 public:
  /**
   * @param address  Windows: \\\\.\\pipe\\niuma.xxx ；Unix: /tmp/niuma.xxx.sock
   * @param handler  业务分发（通常绑定各服务 Dispatcher::HandleFrame）
   * @param log_name 日志前缀，如 "oracle-service"
   */
  Server(std::string address, FrameHandler handler, std::string log_name = "serviceipc");
  ~Server();

  Server(const Server&) = delete;
  Server& operator=(const Server&) = delete;

  /** 阻塞直到 Stop() 或致命错误；成功监听循环退出返回 0。 */
  int Serve();
  void Stop();

 private:
  std::string address_;
  FrameHandler handler_;
  std::string log_name_;
  std::atomic<bool> stopping_{false};
};

}  // namespace niuma::serviceipc
