#include "niuma/sqllsp/connection.hpp"

#include <chrono>

namespace niuma::sqllsp {
namespace {

std::string NextConnId(std::uint64_t seq) {
  const auto now = std::chrono::steady_clock::now().time_since_epoch().count();
  return "lsp-" + std::to_string(now) + "-" + std::to_string(seq);
}

}  // namespace

void DocumentStore::Put(const std::string& uri, int version, std::string text) {
  std::lock_guard lock(mu_);
  auto& doc = docs_[uri];
  doc.version = version;
  doc.text = std::move(text);
}

bool DocumentStore::Get(const std::string& uri, Document& out) const {
  std::lock_guard lock(mu_);
  const auto it = docs_.find(uri);
  if (it == docs_.end()) {
    return false;
  }
  out = it->second;
  return true;
}

void DocumentStore::Erase(const std::string& uri) {
  std::lock_guard lock(mu_);
  docs_.erase(uri);
}

void DocumentStore::SetSuggestDatabase(const std::string& uri, const std::string& database,
                                       const std::string& schema) {
  std::lock_guard lock(mu_);
  auto& doc = docs_[uri];
  doc.suggest_database = database;
  if (!schema.empty()) {
    doc.suggest_schema = schema;
  }
}

Connection* Manager::Open(const std::string& session_id, const std::string& client_id,
                          const std::string& suggest_database) {
  std::lock_guard lock(mu_);
  const std::string id = NextConnId(++seq_);
  auto conn = std::make_unique<Connection>();
  conn->id = id;
  conn->session_id = session_id;
  conn->client_id = client_id;
  conn->suggest_database = suggest_database;
  conn->suggest_schema = suggest_database;
  auto* raw = conn.get();
  conns_.emplace(id, std::move(conn));
  return raw;
}

Connection* Manager::Get(const std::string& id) {
  std::lock_guard lock(mu_);
  auto it = conns_.find(id);
  if (it == conns_.end()) {
    return nullptr;
  }
  return it->second.get();
}

bool Manager::Close(const std::string& id) {
  std::lock_guard lock(mu_);
  return conns_.erase(id) > 0;
}

bool Manager::UpdateSuggestDatabase(const std::string& id, const std::string& database,
                                    const std::string& schema) {
  std::lock_guard lock(mu_);
  auto it = conns_.find(id);
  if (it == conns_.end()) {
    return false;
  }
  it->second->suggest_database = database;
  if (!schema.empty()) {
    it->second->suggest_schema = schema;
  } else if (!database.empty()) {
    it->second->suggest_schema = database;
  }
  return true;
}

int Manager::CloseBySession(const std::string& session_id) {
  std::lock_guard lock(mu_);
  int n = 0;
  for (auto it = conns_.begin(); it != conns_.end();) {
    if (it->second->session_id == session_id) {
      it = conns_.erase(it);
      ++n;
    } else {
      ++it;
    }
  }
  return n;
}

}  // namespace niuma::sqllsp
