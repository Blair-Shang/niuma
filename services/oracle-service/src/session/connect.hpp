#pragma once

#include "dialect/profile.hpp"

#include <dpi.h>
#include <niuma/netproxy/netproxy.hpp>
#include <nlohmann/json.hpp>
#include <memory>
#include <string>

namespace niuma::oracle::session {

struct TunnelOptions {
  std::string type;  // none | ssh
  bool Enabled() const { return !type.empty() && type != "none"; }
};

struct ConnectOptions {
  std::string schema;
  std::string database;
  std::string service_name;
  std::string sid;
  std::string role;  // normal | sysdba | sysoper
  std::string app_name;
  int connect_timeout_seconds = 30;
  bool exclude_system_schemas = true;
  // disable | require | verify-full（TCPS；后两者走 PROTOCOL=tcps）
  std::string ssl_mode;
  std::string wallet_path;
  std::string wallet_password;  // 预留；运行时优先使用自动登录钱包（cwallet.sso）
  niuma::netproxy::Options proxy;
  TunnelOptions tunnel;

  bool SslEnabled() const;
  bool SslVerify() const;
};

struct ConnectParams {
  std::string host_address;
  int port_number = 1521;
  std::string login_account;
  std::string secret;
  ConnectOptions options;

  static ConnectParams FromJson(const nlohmann::json& j);
  std::string SchemaOrEmpty() const;
  std::string BuildConnectString() const;
};

struct DpiContextDeleter {
  void operator()(dpiContext* ctx) const {
    if (ctx) {
      dpiContext_destroy(ctx);
    }
  }
};

struct DpiConnDeleter {
  void operator()(dpiConn* conn) const {
    if (conn) {
      dpiConn_release(conn);
    }
  }
};

using ContextPtr = std::shared_ptr<dpiContext>;
using ConnPtr = std::unique_ptr<dpiConn, DpiConnDeleter>;

// 进程级 ODPI context（懒创建，加载 Instant Client）。
ContextPtr SharedContext(std::string& error);

struct OpenedConnection {
  // proxy_relay 声明在前：析构时最后释放，避免 ODPI 连接仍经本地转发时端口先关。
  std::unique_ptr<niuma::netproxy::RelayGuard> proxy_relay;
  ConnPtr conn;
  dialect::ServerProfile profile;
};

OpenedConnection ConnectAndProbe(const ConnectParams& params, std::string& error);

}  // namespace niuma::oracle::session
