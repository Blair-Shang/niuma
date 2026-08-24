#pragma once

#include "niuma/sqllsp/types.hpp"

#include <string>
#include <vector>

namespace niuma::sqllsp {

/** 方言解析器：关键字 / 槽位 / 可选诊断。 */
class DialectParser {
 public:
  virtual ~DialectParser() = default;

  virtual std::vector<std::string> Keywords() const = 0;
  virtual std::vector<std::string> Functions() const { return {}; }
  virtual std::vector<Diagnostic> Diagnostics(const std::string& /*uri*/,
                                              const std::string& /*text*/) const {
    return {};
  }
  virtual CompletionContext CompletionContext(const std::string& text, Position pos) const = 0;
  virtual std::string QuoteIdent(const std::string& name) const { return name; }
};

}  // namespace niuma::sqllsp
