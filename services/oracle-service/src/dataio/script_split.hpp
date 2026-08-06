#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <iosfwd>
#include <string>
#include <string_view>
#include <vector>

namespace niuma::oracle::dataio {

/**
 * 按 Oracle SQL*Plus 脚本规则拆句：
 * - 独占一行的 / 始终作为批结束（不把 / 写入语句）
 * - 普通 SQL 在引号/注释外的 ; 处分句
 * - CREATE PROCEDURE/FUNCTION/PACKAGE/TRIGGER/TYPE、DECLARE、匿名 BEGIN 视为 PL/SQL，
 *   体内 ; 不拆句，只等 / 或文件结束
 *
 * 返回的语句已 Trim，不含结尾 ; 或 /。
 */
std::vector<std::string> SplitSqlScript(const std::string& text);

/**
 * 增量 Oracle SQL*Plus 脚本拆句器。
 *
 * 回调在语句完整时立即触发；第二个参数是该语句终止符之后的累计输入字节数。
 * 回调返回 false 可停止继续解析。Finish() 会产出文件末尾未带终止符的语句。
 */
class SqlScriptSplitter {
 public:
  using StatementCallback = std::function<bool(std::string&& sql, std::uint64_t bytes_consumed)>;

  explicit SqlScriptSplitter(StatementCallback callback, std::uint64_t initial_byte_offset = 0);

  bool Feed(std::string_view chunk);
  bool Finish();
  std::uint64_t bytes_consumed() const { return byte_offset_; }

 private:
  enum class State {
    kNormal,
    kSingleQuote,
    kDoubleQuote,
    kLineComment,
    kBlockComment,
    kQQuote,
  };

  bool Process(std::string_view chunk, bool final);
  bool Emit(std::uint64_t end_offset);

  StatementCallback callback_;
  std::string statement_;
  std::string carry_;
  std::uint64_t byte_offset_ = 0;
  State state_ = State::kNormal;
  char q_quote_closer_ = '\0';
  bool line_has_non_whitespace_ = false;
  bool plsql_sticky_ = false;
  bool finished_ = false;
  bool stopped_ = false;
};

/** 从流分块读取并增量产出语句；callback 返回 false 时停止。 */
bool SplitSqlScript(std::istream& input, const SqlScriptSplitter::StatementCallback& callback,
                    std::size_t chunk_size = 64 * 1024);

/** 判断缓冲是否以需 / 结束的 PL/SQL 单元开头（供单测）。 */
bool LooksLikePlsqlUnit(const std::string& sql);

}  // namespace niuma::oracle::dataio
