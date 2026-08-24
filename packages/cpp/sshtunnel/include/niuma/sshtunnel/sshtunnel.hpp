#pragma once

#include <niuma/netproxy/netproxy.hpp>

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <thread>

namespace niuma::sshtunnel {

// 与 Web / Go tunnel.SSHProfile / Rust SshTunnelProfile 对齐（平台 InjectSSHProfile 后）。
struct SSHProfile {
  std::string host_address;
  int port_number = 22;
  std::string login_account;
  std::string secret;  // 密码或私钥 PEM 内容
  int timeout_seconds = 30;
  std::string auth_type;  // password | private_key | private_key_file
  std::string private_key_path;
  std::string passphrase;
  niuma::netproxy::Options proxy;  // 跳板机自身的出站代理（可选）
};

// 与 connection_options.tunnel JSON 对齐。
struct Options {
  std::string type;  // none | ssh
  std::string target_host;
  int target_port = 0;
  SSHProfile ssh_profile;
  bool has_ssh_profile = false;

  bool Enabled() const;
};

// 本地 127.0.0.1 转发句柄：析构时停止监听并断开 SSH。
class TunnelGuard {
 public:
  TunnelGuard() = default;
  ~TunnelGuard();

  TunnelGuard(const TunnelGuard&) = delete;
  TunnelGuard& operator=(const TunnelGuard&) = delete;
  TunnelGuard(TunnelGuard&&) = delete;
  TunnelGuard& operator=(TunnelGuard&&) = delete;

  void Stop();

 private:
  friend std::unique_ptr<TunnelGuard> StartSSHTunnel(const Options& opts, const std::string& default_target_host,
                                                    uint16_t default_target_port, std::string& local_host,
                                                    uint16_t& local_port, std::string& error);

  struct Impl;
  std::unique_ptr<Impl> impl_;
};

// 建立 SSH direct-tcpip 隧道：本机监听随机端口，经跳板转发到目标。
// default_target_* 在 Options.target_* 未指定时使用。成功返回 guard；失败 error 非空。
std::unique_ptr<TunnelGuard> StartSSHTunnel(const Options& opts, const std::string& default_target_host,
                                            uint16_t default_target_port, std::string& local_host,
                                            uint16_t& local_port, std::string& error);

}  // namespace niuma::sshtunnel
