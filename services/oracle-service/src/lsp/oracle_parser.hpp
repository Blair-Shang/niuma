#pragma once

#include "niuma/sqllsp/parser.hpp"

#include <string>
#include <vector>

namespace niuma::oracle::lsp {

/** Oracle 启发式 DialectParser（对齐达梦早期补全路径）。 */
class OracleParser final : public niuma::sqllsp::DialectParser {
 public:
  std::vector<std::string> Keywords() const override;
  std::vector<std::string> Functions() const override;
  niuma::sqllsp::CompletionContext CompletionContext(const std::string& text,
                                                     niuma::sqllsp::Position pos) const override;
  std::string QuoteIdent(const std::string& name) const override;
};

}  // namespace niuma::oracle::lsp
