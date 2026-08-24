#pragma once

#include "dataio/manager.hpp"
#include "lsp/bridge.hpp"
#include "session/manager.hpp"

#include <memory>
#include <string>

namespace niuma::oracle::handler {

class Dispatcher {
 public:
  Dispatcher();
  std::string HandleFrame(const std::string& raw_json);

 private:
  session::Manager sessions_;
  dataio::Manager io_;
  std::unique_ptr<lsp::Bridge> lsp_;
};

}  // namespace niuma::oracle::handler
