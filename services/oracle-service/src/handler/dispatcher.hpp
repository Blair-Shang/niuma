#pragma once

#include "dataio/manager.hpp"
#include "session/manager.hpp"

#include <string>

namespace niuma::oracle::handler {

class Dispatcher {
 public:
  Dispatcher();
  std::string HandleFrame(const std::string& raw_json);

 private:
  session::Manager sessions_;
  dataio::Manager io_;
};

}  // namespace niuma::oracle::handler
