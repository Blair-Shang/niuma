#include "lsp/bridge.hpp"

#include "niuma/serviceipc/event.hpp"

#include <nlohmann/json.hpp>

namespace niuma::oracle::lsp {

Bridge::Bridge(session::Manager& sessions) : sessions_(sessions) {}

void Bridge::EnsureServer() {
  if (server_) return;
  catalog_ = std::make_unique<OracleCatalog>(sessions_);
  conns_ = std::make_unique<niuma::sqllsp::Manager>();
  auto notify = [](const std::string& connection_id, const nlohmann::json& message) {
    nlohmann::json ev{
        {"type", "oracle.lsp"},
        {"connectionId", connection_id},
        {"message", message},
    };
    niuma::serviceipc::PublishEvent(ev.dump());
  };
  server_ = std::make_unique<niuma::sqllsp::Server>(&parser_, catalog_.get(), conns_.get(),
                                                    std::move(notify));
  server_->source_name = "oracle-lsp";
  server_->trigger_characters = {".", " ", "\""};
  server_->default_database = [this](const std::string& session_id) -> std::string {
    auto s = sessions_.Get(session_id);
    if (!s) return {};
    return s->params.SchemaOrEmpty();
  };
}

nlohmann::json Bridge::Open(const nlohmann::json& params, std::string& error) {
  const std::string session_id = params.value("sessionId", "");
  const std::string client_id = params.value("clientId", "");
  const std::string database = params.value("database", params.value("schema", ""));
  if (session_id.empty()) {
    error = "sessionId required";
    return {};
  }
  if (!sessions_.Get(session_id)) {
    error = "oracle: session not found";
    return {};
  }
  EnsureServer();
  auto* conn = server_->conns->Open(session_id, client_id, database);
  return {{"connectionId", conn->id}};
}

nlohmann::json Bridge::Rpc(const nlohmann::json& params, std::string& error) {
  const std::string connection_id = params.value("connectionId", "");
  const std::string session_id = params.value("sessionId", "");
  if (connection_id.empty()) {
    error = "connectionId required";
    return {};
  }
  if (!params.contains("message")) {
    error = "message required";
    return {};
  }
  EnsureServer();
  auto* conn = server_->conns->Get(connection_id);
  if (!conn) {
    error = "lsp connection not found: " + connection_id;
    return {};
  }
  if (!session_id.empty() && session_id != conn->session_id) {
    error = "sessionId mismatch";
    return {};
  }
  std::string rpc_err;
  auto resp = server_->HandleMessage(*conn, params["message"], rpc_err);
  if (!rpc_err.empty() && !resp) {
    error = rpc_err;
    return {};
  }
  if (!resp) {
    return {{"ok", true}};
  }
  return {{"message", *resp}};
}

nlohmann::json Bridge::Close(const nlohmann::json& params, std::string& error) {
  const std::string connection_id = params.value("connectionId", "");
  if (connection_id.empty()) {
    error = "connectionId required";
    return {};
  }
  EnsureServer();
  const bool closed = server_->conns->Close(connection_id);
  return {{"closed", closed}};
}

nlohmann::json Bridge::Lexicon(const nlohmann::json& /*params*/, std::string& /*error*/) {
  return {
      {"keywords", parser_.Keywords()},
      {"functions", parser_.Functions()},
  };
}

}  // namespace niuma::oracle::lsp
