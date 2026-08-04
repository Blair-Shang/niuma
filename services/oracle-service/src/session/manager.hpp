#pragma once

#include "dialect/profile.hpp"
#include "session/connect.hpp"
#include "util/stmt_guard.hpp"

#include <dpi.h>
#include <nlohmann/json.hpp>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace niuma::oracle::session {

struct ResultSet {
  util::StmtGuard stmt;
  std::vector<std::string> column_names;
  std::vector<std::string> column_types;
  std::vector<dpiOracleTypeNum> column_oracle_types;
  // 为正确计算 hasMore 而预取的下一行（未交给客户端）。
  std::optional<nlohmann::json> pending_row;
};

struct Session {
  std::string id;
  // proxy_relay 须晚于 conn 析构（声明在前 → 析构在后）。
  std::unique_ptr<niuma::netproxy::RelayGuard> proxy_relay;
  ConnPtr conn;
  ContextPtr ctx;
  ConnectParams params;
  dialect::ServerProfile profile;
  std::mutex mu;
  std::unordered_map<std::string, ResultSet> result_sets;
  dpiStmt* cancel_stmt = nullptr;  // 非拥有指针；生命周期由当前查询 StmtGuard / ResultSet 管理
  std::string active_request_id;
  bool auto_commit = true;
  bool in_tx = false;

  void Close();
};

class Manager {
 public:
  void Put(std::shared_ptr<Session> s);
  std::shared_ptr<Session> Get(const std::string& id);
  bool Close(const std::string& id);

 private:
  std::mutex mu_;
  std::unordered_map<std::string, std::shared_ptr<Session>> sessions_;
};

}  // namespace niuma::oracle::session
