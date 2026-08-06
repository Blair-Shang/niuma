#include "session/tx.hpp"

#include "util/dpi_error.hpp"

namespace niuma::oracle::session {
namespace {

std::string DpiError(dpiContext* ctx) {
  return util::FormatDpiError(ctx, "oracle: tx error");
}

}  // namespace

nlohmann::json TxStateJson(const Session& session) {
  std::lock_guard lock(const_cast<Session&>(session).mu);
  return nlohmann::json{{"autoCommit", session.auto_commit}, {"inTransaction", session.in_tx}};
}

nlohmann::json SetAutoCommit(Session& session, bool enabled, std::string& error) {
  if (!session.conn) {
    error = "oracle: session has no connection";
    return {};
  }
  std::lock_guard lock(session.mu);
  if (enabled) {
    if (session.in_tx) {
      if (dpiConn_rollback(session.conn.get()) < 0) {
        error = DpiError(session.ctx.get());
        return {};
      }
      session.in_tx = false;
    }
    session.auto_commit = true;
  } else {
    session.auto_commit = false;
  }
  return nlohmann::json{{"autoCommit", session.auto_commit}, {"inTransaction", session.in_tx}};
}

nlohmann::json Commit(Session& session, std::string& error) {
  if (!session.conn) {
    error = "oracle: session has no connection";
    return {};
  }
  std::lock_guard lock(session.mu);
  if (session.auto_commit) {
    error = "oracle: auto-commit is on; nothing to commit";
    return {};
  }
  if (dpiConn_commit(session.conn.get()) < 0) {
    error = DpiError(session.ctx.get());
    return {};
  }
  session.in_tx = false;
  return nlohmann::json{{"autoCommit", session.auto_commit}, {"inTransaction", session.in_tx}};
}

nlohmann::json Rollback(Session& session, std::string& error) {
  if (!session.conn) {
    error = "oracle: session has no connection";
    return {};
  }
  std::lock_guard lock(session.mu);
  if (session.auto_commit) {
    error = "oracle: auto-commit is on; nothing to rollback";
    return {};
  }
  if (dpiConn_rollback(session.conn.get()) < 0) {
    error = DpiError(session.ctx.get());
    return {};
  }
  session.in_tx = false;
  return nlohmann::json{{"autoCommit", session.auto_commit}, {"inTransaction", session.in_tx}};
}

bool AfterDml(Session& session, std::string& error) {
  if (!session.conn) {
    error = "oracle: session has no connection";
    return false;
  }
  std::lock_guard lock(session.mu);
  if (session.auto_commit) {
    if (dpiConn_commit(session.conn.get()) < 0) {
      error = DpiError(session.ctx.get());
      return false;
    }
    session.in_tx = false;
  } else {
    session.in_tx = true;
  }
  return true;
}

}  // namespace niuma::oracle::session
