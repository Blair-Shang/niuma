#include "session/manager.hpp"

namespace niuma::oracle::session {

void Session::Close() {
  std::lock_guard lock(mu);
  cancel_stmt = nullptr;
  active_request_id.clear();
  result_sets.clear();  // StmtGuard 析构释放 dpiStmt
  conn.reset();
  // 先关 ODPI 连接，再停本地转发（代理 / SSH），避免半开读写。
  proxy_relay.reset();
  ssh_tunnel.reset();
}

void Manager::Put(std::shared_ptr<Session> s) {
  std::lock_guard lock(mu_);
  sessions_[s->id] = std::move(s);
}

std::shared_ptr<Session> Manager::Get(const std::string& id) {
  std::lock_guard lock(mu_);
  const auto it = sessions_.find(id);
  if (it == sessions_.end()) {
    return nullptr;
  }
  return it->second;
}

bool Manager::Close(const std::string& id) {
  std::shared_ptr<Session> s;
  {
    std::lock_guard lock(mu_);
    const auto it = sessions_.find(id);
    if (it == sessions_.end()) {
      return false;
    }
    s = it->second;
    sessions_.erase(it);
  }
  if (s) {
    s->Close();
  }
  return true;
}

}  // namespace niuma::oracle::session
