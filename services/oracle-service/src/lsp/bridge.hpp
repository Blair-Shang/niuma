#pragma once

#include "lsp/oracle_catalog.hpp"
#include "lsp/oracle_parser.hpp"
#include "niuma/sqllsp/server.hpp"
#include "session/manager.hpp"

#include <memory>
#include <nlohmann/json.hpp>
#include <string>

namespace niuma::oracle::lsp {

/** Bridge：oracle.lsp.open|rpc|close|lexicon。 */
class Bridge {
 public:
  explicit Bridge(session::Manager& sessions);

  nlohmann::json Open(const nlohmann::json& params, std::string& error);
  nlohmann::json Rpc(const nlohmann::json& params, std::string& error);
  nlohmann::json Close(const nlohmann::json& params, std::string& error);
  nlohmann::json Lexicon(const nlohmann::json& params, std::string& error);

 private:
  void EnsureServer();

  session::Manager& sessions_;
  OracleParser parser_;
  std::unique_ptr<OracleCatalog> catalog_;
  std::unique_ptr<niuma::sqllsp::Manager> conns_;
  std::unique_ptr<niuma::sqllsp::Server> server_;
};

}  // namespace niuma::oracle::lsp
