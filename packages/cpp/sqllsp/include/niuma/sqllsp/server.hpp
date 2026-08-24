#pragma once

#include "niuma/sqllsp/catalog.hpp"
#include "niuma/sqllsp/connection.hpp"
#include "niuma/sqllsp/parser.hpp"

#include <functional>
#include <nlohmann/json.hpp>
#include <optional>
#include <string>
#include <vector>

namespace niuma::sqllsp {

using NotifyFn = std::function<void(const std::string& connection_id, const nlohmann::json& message)>;

/**
 * SQL Language Server 核心（对齐 packages/go/sqllsp）。
 * parser / catalog 由调用方持有生命周期；Manager 可由 Server 拥有。
 */
class Server {
 public:
  Server(DialectParser* parser, Catalog* catalog, Manager* conns, NotifyFn notify);

  DialectParser* parser = nullptr;
  Catalog* catalog = nullptr;
  Manager* conns = nullptr;
  NotifyFn notify;
  std::function<std::string(const std::string& session_id)> default_database;
  int catalog_limit = kDefaultCatalogLimit;
  std::string source_name = "sqllsp";
  std::vector<std::string> trigger_characters{".", " ", "\""};

  /**
   * 处理一帧 JSON-RPC。
   * - request：返回响应对象
   * - notification：返回 nullopt，error 为空表示成功
   */
  std::optional<nlohmann::json> HandleMessage(Connection& conn, const nlohmann::json& msg,
                                              std::string& error);

 private:
  nlohmann::json Initialize();
  bool DidOpen(Connection& conn, const nlohmann::json& params, std::string& error);
  bool DidChange(Connection& conn, const nlohmann::json& params, std::string& error);
  bool DidClose(Connection& conn, const nlohmann::json& params, std::string& error);
  bool SetSuggestDatabase(Connection& conn, const nlohmann::json& params, std::string& error);
  nlohmann::json Completion(Connection& conn, const nlohmann::json& params, std::string& error);

  std::string SuggestDB(const Connection& conn, const std::string& uri) const;
  std::string SuggestSchema(const Connection& conn, const std::string& uri) const;
  std::string QuoteIdent(const std::string& name) const;
  void EmitDiagnostics(const std::string& connection_id, const std::string& uri, int version,
                       const std::vector<Diagnostic>& diags);
};

}  // namespace niuma::sqllsp
