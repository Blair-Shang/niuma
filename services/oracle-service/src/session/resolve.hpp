#pragma once

#include "session/manager.hpp"

#include <functional>
#include <memory>
#include <nlohmann/json.hpp>
#include <string>

namespace niuma::oracle::session {

// 解析树/catalog/meta 用会话：优先 sessionId；否则用注入的 ConnectParams 短连。
// 返回的 release 必须在用完后调用（短连会关闭连接）。
struct ResolvedSession {
  std::shared_ptr<Session> session;
  std::function<void()> release;
  bool ok = false;
  std::string error;
};

ResolvedSession ResolveSession(Manager& sessions, const nlohmann::json& params);

}  // namespace niuma::oracle::session
