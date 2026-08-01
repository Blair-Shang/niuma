#pragma once

#include "dialect/profile.hpp"

#include <dpi.h>
#include <nlohmann/json.hpp>
#include <memory>
#include <string>

namespace niuma::oracle::session {

struct ConnectOptions {
  std::string schema;
  std::string database;
  std::string service_name;
  std::string sid;
  std::string role;  // normal | sysdba | sysoper
  std::string app_name;
  int connect_timeout_seconds = 30;
  bool exclude_system_schemas = true;
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
  ConnPtr conn;
  dialect::ServerProfile profile;
};

OpenedConnection ConnectAndProbe(const ConnectParams& params, std::string& error);

}  // namespace niuma::oracle::session
