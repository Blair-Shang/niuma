#include "dataio/script_split.hpp"

#include <algorithm>
#include <cctype>
#include <istream>
#include <string>
#include <utility>
#include <vector>

namespace niuma::oracle::dataio {
namespace {

bool IsSpaceByte(unsigned char c) {
  return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f' || c == '\v';
}

std::string TrimSpace(std::string s) {
  size_t b = 0;
  while (b < s.size() && IsSpaceByte(static_cast<unsigned char>(s[b]))) {
    ++b;
  }
  size_t e = s.size();
  while (e > b && IsSpaceByte(static_cast<unsigned char>(s[e - 1]))) {
    --e;
  }
  return s.substr(b, e - b);
}

std::string TrimRightSemicolonAndSpace(std::string s) {
  while (!s.empty()) {
    const unsigned char c = static_cast<unsigned char>(s.back());
    if (c == ';' || IsSpaceByte(c)) {
      s.pop_back();
      continue;
    }
    break;
  }
  return TrimSpace(std::move(s));
}

std::string ToUpperAscii(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  }
  return s;
}

char QQuoteCloser(char open) {
  switch (open) {
    case '[':
      return ']';
    case '{':
      return '}';
    case '<':
      return '>';
    case '(':
      return ')';
    default:
      return open;
  }
}

std::string StripSQLLeadingNoise(std::string sql) {
  for (;;) {
    sql = TrimSpace(sql);
    if (sql.size() >= 2 && sql[0] == '-' && sql[1] == '-') {
      const size_t nl = sql.find('\n');
      if (nl == std::string::npos) {
        return {};
      }
      sql = sql.substr(nl + 1);
      continue;
    }
    if (sql.size() >= 2 && sql[0] == '/' && sql[1] == '*') {
      const size_t end = sql.find("*/");
      if (end == std::string::npos) {
        return {};
      }
      sql = sql.substr(end + 2);
      continue;
    }
    return sql;
  }
}

}  // namespace

bool LooksLikePlsqlUnit(const std::string& sql) {
  const std::string s = StripSQLLeadingNoise(sql);
  if (s.empty()) {
    return false;
  }
  const std::string upper = ToUpperAscii(s);
  if (upper.rfind("DECLARE", 0) == 0) {
    return true;
  }
  if (upper.rfind("BEGIN", 0) == 0) {
    return true;
  }
  if (upper.rfind("CREATE", 0) == 0) {
    std::string rest = TrimSpace(upper.substr(6));
    if (rest.rfind("OR REPLACE", 0) == 0) {
      rest = TrimSpace(rest.substr(10));
    }
    static const char* kws[] = {"PROCEDURE", "FUNCTION", "PACKAGE", "TRIGGER", "TYPE"};
    for (const char* kw : kws) {
      if (rest.rfind(kw, 0) == 0) {
        return true;
      }
    }
  }
  return false;
}

SqlScriptSplitter::SqlScriptSplitter(StatementCallback callback, std::uint64_t initial_byte_offset)
    : callback_(std::move(callback)), byte_offset_(initial_byte_offset) {}

bool SqlScriptSplitter::Emit(std::uint64_t end_offset) {
  std::string raw = TrimSpace(std::move(statement_));
  statement_.clear();
  plsql_sticky_ = false;
  if (raw.empty()) {
    return true;
  }
  raw = TrimRightSemicolonAndSpace(std::move(raw));
  if (raw.empty()) {
    return true;
  }
  if (callback_ && !callback_(std::move(raw), end_offset)) {
    stopped_ = true;
    return false;
  }
  return true;
}

bool SqlScriptSplitter::Feed(std::string_view chunk) {
  if (finished_ || stopped_) {
    return false;
  }
  return Process(chunk, false);
}

bool SqlScriptSplitter::Finish() {
  if (finished_ || stopped_) {
    return false;
  }
  finished_ = true;
  return Process({}, true);
}

bool SqlScriptSplitter::Process(std::string_view chunk, bool final) {
  std::string input;
  input.reserve(carry_.size() + chunk.size());
  input.append(carry_);
  if (!chunk.empty()) {
    input.append(chunk.data(), chunk.size());
  }
  carry_.clear();

  const std::uint64_t base_offset = byte_offset_;
  const std::size_t n = input.size();
  std::size_t i = 0;
  auto defer_from = [&](std::size_t pos) {
    carry_.assign(input, pos, std::string::npos);
    byte_offset_ = base_offset + pos;
  };

  while (i < n) {
    const char c = input[i];

    if (state_ == State::kLineComment) {
      ++i;
      if (c == '\n') {
        state_ = State::kNormal;
        line_has_non_whitespace_ = false;
        statement_.push_back(c);
      }
      continue;
    }

    if (state_ == State::kBlockComment) {
      if (c == '*' && i + 1 >= n && !final) {
        defer_from(i);
        return true;
      }
      if (c == '*' && i + 1 < n && input[i + 1] == '/') {
        state_ = State::kNormal;
        i += 2;
        continue;
      }
      if (c == '\n') {
        line_has_non_whitespace_ = false;
      }
      ++i;
      continue;
    }

    if (state_ == State::kSingleQuote || state_ == State::kDoubleQuote) {
      const char quote = state_ == State::kSingleQuote ? '\'' : '"';
      if (c == quote && i + 1 >= n && !final) {
        defer_from(i);
        return true;
      }
      statement_.push_back(c);
      ++i;
      if (c != quote) {
        continue;
      }
      if (i < n && input[i] == quote) {
        statement_.push_back(input[i]);
        ++i;
      } else {
        state_ = State::kNormal;
      }
      continue;
    }

    if (state_ == State::kQQuote) {
      if (c == q_quote_closer_ && i + 1 >= n && !final) {
        defer_from(i);
        return true;
      }
      statement_.push_back(c);
      ++i;
      if (c == q_quote_closer_ && i < n && input[i] == '\'') {
        statement_.push_back(input[i]);
        ++i;
        state_ = State::kNormal;
      }
      continue;
    }

    // 以下分支都在普通 SQL 状态。
    if ((c == 'q' || c == 'Q') && i + 1 >= n && !final) {
      defer_from(i);
      return true;
    }
    if ((c == 'q' || c == 'Q') && i + 1 < n && input[i + 1] == '\'') {
      if (i + 2 >= n && !final) {
        defer_from(i);
        return true;
      }
      if (i + 2 < n) {
        q_quote_closer_ = QQuoteCloser(input[i + 2]);
        statement_.append(input, i, 3);
        i += 3;
        state_ = State::kQQuote;
        line_has_non_whitespace_ = true;
        continue;
      }
    }

    if ((c == '-' || c == '/') && i + 1 >= n && !final) {
      defer_from(i);
      return true;
    }
    if (c == '-' && i + 1 < n && input[i + 1] == '-') {
      state_ = State::kLineComment;
      i += 2;
      continue;
    }
    if (c == '/' && i + 1 < n && input[i + 1] == '*') {
      state_ = State::kBlockComment;
      i += 2;
      continue;
    }

    // 独占一行的 / 是批终止符；跨 chunk 时保留候选行，等待后续字节确认。
    if (c == '/' && !line_has_non_whitespace_) {
      std::size_t j = i + 1;
      while (j < n && input[j] != '\n' &&
             (input[j] == ' ' || input[j] == '\t' || input[j] == '\r')) {
        ++j;
      }
      if (j == n && !final) {
        defer_from(i);
        return true;
      }
      if (j == n || input[j] == '\n') {
        const std::size_t end = j < n ? j + 1 : j;
        if (!Emit(base_offset + end)) {
          byte_offset_ = base_offset + end;
          return false;
        }
        i = end;
        line_has_non_whitespace_ = false;
        continue;
      }
    }

    if (c == '\'' || c == '"') {
      state_ = c == '\'' ? State::kSingleQuote : State::kDoubleQuote;
      statement_.push_back(c);
      line_has_non_whitespace_ = true;
      ++i;
      continue;
    }
    if (c == '\n') {
      statement_.push_back(c);
      line_has_non_whitespace_ = false;
      ++i;
      continue;
    }
    if (c == ';') {
      if (!plsql_sticky_) {
        plsql_sticky_ = LooksLikePlsqlUnit(statement_);
      }
      ++i;
      if (!plsql_sticky_) {
        if (!Emit(base_offset + i)) {
          byte_offset_ = base_offset + i;
          return false;
        }
        continue;
      }
      statement_.push_back(c);
      line_has_non_whitespace_ = true;
      continue;
    }

    if (c != ' ' && c != '\t' && c != '\r') {
      line_has_non_whitespace_ = true;
    }
    statement_.push_back(c);
    ++i;
  }

  byte_offset_ = base_offset + n;
  if (final) {
    return Emit(byte_offset_);
  }
  return true;
}

bool SplitSqlScript(std::istream& input, const SqlScriptSplitter::StatementCallback& callback,
                    std::size_t chunk_size) {
  if (chunk_size == 0) {
    chunk_size = 1;
  }
  SqlScriptSplitter splitter(callback);
  std::vector<char> buffer(chunk_size);
  while (input) {
    input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
    const std::streamsize count = input.gcount();
    if (count > 0 &&
        !splitter.Feed(std::string_view(buffer.data(), static_cast<std::size_t>(count)))) {
      return false;
    }
  }
  if (input.bad()) {
    return false;
  }
  return splitter.Finish();
}

std::vector<std::string> SplitSqlScript(const std::string& text) {
  std::vector<std::string> out;
  SqlScriptSplitter splitter(
      [&](std::string&& sql, std::uint64_t) {
        out.push_back(std::move(sql));
        return true;
      });
  (void)splitter.Feed(text);
  (void)splitter.Finish();
  return out;
}

}  // namespace niuma::oracle::dataio
