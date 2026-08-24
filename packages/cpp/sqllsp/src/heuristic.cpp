#include "niuma/sqllsp/heuristic.hpp"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <unordered_map>
#include <unordered_set>

namespace niuma::sqllsp {
namespace {

bool IsAsciiSpace(unsigned char c) {
  return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f' || c == '\v';
}

bool IsIdentStart(unsigned char c) {
  return std::isalpha(c) || c == '_' || c == '$';
}

bool IsIdentPart(unsigned char c) {
  return std::isalnum(c) || c == '_' || c == '$';
}

bool IsIdentCharQuoted(unsigned char c) {
  return IsIdentPart(c) || c == '`' || c == '"';
}

std::string ToLower(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return s;
}

std::string TrimSpace(std::string s) {
  size_t b = 0;
  while (b < s.size() && IsAsciiSpace(static_cast<unsigned char>(s[b]))) ++b;
  size_t e = s.size();
  while (e > b && IsAsciiSpace(static_cast<unsigned char>(s[e - 1]))) --e;
  return s.substr(b, e - b);
}

std::string StripIdent(std::string s) {
  s = TrimSpace(std::move(s));
  if (s.size() >= 2) {
    const char a = s.front();
    const char b = s.back();
    if ((a == '"' && b == '"') || (a == '`' && b == '`')) {
      return s.substr(1, s.size() - 2);
    }
  }
  return s;
}

std::string CoalesceSchema(const std::string& schema, const std::string& default_db) {
  const std::string s = TrimSpace(schema);
  if (!s.empty()) return s;
  return TrimSpace(default_db);
}

void CurrentStatementSpan(const std::string& text, int offset, int& start, std::string& stmt) {
  if (offset < 0) offset = 0;
  if (offset > static_cast<int>(text.size())) offset = static_cast<int>(text.size());
  start = offset;
  while (start > 0 && text[static_cast<size_t>(start - 1)] != ';') --start;
  int end = offset;
  while (end < static_cast<int>(text.size()) && text[static_cast<size_t>(end)] != ';') ++end;
  stmt = text.substr(static_cast<size_t>(start), static_cast<size_t>(end - start));
}

struct SqlTok {
  std::string raw;
  int start = 0;
  int end = 0;
};

std::vector<SqlTok> TokenizeSQL(const std::string& s) {
  std::vector<SqlTok> out;
  size_t i = 0;
  while (i < s.size()) {
    const unsigned char c = static_cast<unsigned char>(s[i]);
    if (IsAsciiSpace(c)) {
      ++i;
      continue;
    }
    if (c == '-' && i + 1 < s.size() && s[i + 1] == '-') {
      while (i < s.size() && s[i] != '\n') ++i;
      continue;
    }
    if (c == '/' && i + 1 < s.size() && s[i + 1] == '*') {
      i += 2;
      while (i + 1 < s.size() && !(s[i] == '*' && s[i + 1] == '/')) ++i;
      if (i + 1 < s.size()) i += 2;
      continue;
    }
    const int start = static_cast<int>(i);
    if (c == '"' || c == '`' || c == '\'') {
      const char q = static_cast<char>(c);
      ++i;
      while (i < s.size()) {
        if (s[i] == q) {
          ++i;
          if (i < s.size() && s[i] == q) {
            ++i;
            continue;
          }
          break;
        }
        ++i;
      }
      out.push_back(SqlTok{s.substr(static_cast<size_t>(start), i - static_cast<size_t>(start)), start,
                           static_cast<int>(i)});
      continue;
    }
    if (c == ',' || c == '(' || c == ')' || c == '.' || c == ';') {
      out.push_back(SqlTok{std::string(1, static_cast<char>(c)), start, start + 1});
      ++i;
      continue;
    }
    if (IsIdentStart(c)) {
      ++i;
      while (i < s.size() && IsIdentPart(static_cast<unsigned char>(s[i]))) ++i;
      out.push_back(SqlTok{s.substr(static_cast<size_t>(start), i - static_cast<size_t>(start)), start,
                           static_cast<int>(i)});
      continue;
    }
    out.push_back(SqlTok{std::string(1, static_cast<char>(c)), start, start + 1});
    ++i;
  }
  return out;
}

bool IsIdentLike(const std::string& raw) {
  if (raw.empty()) return false;
  if (raw.front() == '"' || raw.front() == '`') return true;
  return IsIdentStart(static_cast<unsigned char>(raw.front()));
}

const std::unordered_set<std::string> kClauseStop = {
    "where", "group", "order", "having", "limit", "offset", "union", "set", "on", "using",
    "returning", "window", "for", "fetch", "start", "connect",
};

bool ParseTableRef(const std::vector<SqlTok>& tokens, size_t i, TableRef& ref, size_t& next) {
  if (i >= tokens.size() || !IsIdentLike(tokens[i].raw)) return false;
  std::string a = StripIdent(tokens[i].raw);
  size_t j = i + 1;
  std::string schema;
  std::string name = a;
  if (j + 1 < tokens.size() && tokens[j].raw == "." && IsIdentLike(tokens[j + 1].raw)) {
    schema = a;
    name = StripIdent(tokens[j + 1].raw);
    j += 2;
  }
  std::string alias;
  if (j < tokens.size()) {
    if (ToLower(tokens[j].raw) == "as" && j + 1 < tokens.size() && IsIdentLike(tokens[j + 1].raw)) {
      alias = StripIdent(tokens[j + 1].raw);
      j += 2;
    } else if (IsIdentLike(tokens[j].raw)) {
      const std::string n = ToLower(tokens[j].raw);
      if (!kClauseStop.count(n) && n != "left" && n != "right" && n != "inner" && n != "outer" &&
          n != "cross" && n != "join" && n != "on" && n != "using" && n != "natural" &&
          n != "full") {
        alias = StripIdent(tokens[j].raw);
        ++j;
      }
    }
  }
  ref = TableRef{schema, name, alias, false, {}};
  next = j;
  return true;
}

std::vector<TableRef> ScanTableRefs(const std::string& stmt) {
  const auto tokens = TokenizeSQL(stmt);
  std::vector<TableRef> refs;
  size_t i = 0;
  while (i < tokens.size()) {
    const std::string kw = ToLower(tokens[i].raw);
    if (kw == "from" || kw == "join" || kw == "update" || kw == "into") {
      ++i;
      while (i < tokens.size()) {
        const std::string low = ToLower(tokens[i].raw);
        if (kClauseStop.count(low)) break;
        if (low == "left" || low == "right" || low == "inner" || low == "outer" || low == "cross" ||
            low == "natural" || low == "full") {
          break;
        }
        if (low == "join" || low == "from" || low == "update" || low == "into") break;
        if (tokens[i].raw == ",") {
          ++i;
          continue;
        }
        if (tokens[i].raw == "(") {
          // 跳过派生表括号，尽量取别名
          int depth = 0;
          size_t k = i;
          for (; k < tokens.size(); ++k) {
            if (tokens[k].raw == "(") ++depth;
            else if (tokens[k].raw == ")") {
              --depth;
              if (depth == 0) {
                ++k;
                break;
              }
            }
          }
          i = k;
          std::string alias;
          if (i < tokens.size()) {
            if (ToLower(tokens[i].raw) == "as" && i + 1 < tokens.size() &&
                IsIdentLike(tokens[i + 1].raw)) {
              alias = StripIdent(tokens[i + 1].raw);
              i += 2;
            } else if (IsIdentLike(tokens[i].raw)) {
              const std::string n = ToLower(tokens[i].raw);
              if (!kClauseStop.count(n) && n != "left" && n != "right" && n != "inner" &&
                  n != "outer" && n != "cross" && n != "join" && n != "on") {
                alias = StripIdent(tokens[i].raw);
                ++i;
              }
            }
          }
          if (!alias.empty()) {
            refs.push_back(TableRef{"", alias, alias, true, {}});
          }
          continue;
        }
        TableRef ref;
        size_t next = i;
        if (!ParseTableRef(tokens, i, ref, next)) {
          ++i;
          continue;
        }
        refs.push_back(std::move(ref));
        i = next;
        if (i < tokens.size() && tokens[i].raw == ",") {
          ++i;
          continue;
        }
        break;
      }
      continue;
    }
    ++i;
  }
  return refs;
}

bool SplitTrailingDotIdent(const std::string& before, std::string& left, std::string& right) {
  int i = static_cast<int>(before.size()) - 1;
  while (i >= 0 && IsIdentCharQuoted(static_cast<unsigned char>(before[static_cast<size_t>(i)]))) {
    --i;
  }
  right = before.substr(static_cast<size_t>(i + 1));
  if (i < 0 || before[static_cast<size_t>(i)] != '.') return false;
  int j = i - 1;
  while (j >= 0 && IsIdentCharQuoted(static_cast<unsigned char>(before[static_cast<size_t>(j)]))) {
    --j;
  }
  left = before.substr(static_cast<size_t>(j + 1), static_cast<size_t>(i - j - 1));
  return !left.empty();
}

bool SplitQual(const std::string& name_in, std::string& schema, std::string& table) {
  const std::string name = StripIdent(name_in);
  const size_t dot = name.rfind('.');
  if (dot != std::string::npos && dot > 0) {
    schema = name.substr(0, dot);
    table = name.substr(dot + 1);
    return true;
  }
  schema.clear();
  table = name;
  return false;
}

std::string LastIdent(const std::string& s_in) {
  const std::string s = TrimSpace(s_in);
  int i = static_cast<int>(s.size()) - 1;
  while (i >= 0) {
    const unsigned char c = static_cast<unsigned char>(s[static_cast<size_t>(i)]);
    if (IsIdentCharQuoted(c) || c == '.') {
      --i;
      continue;
    }
    break;
  }
  return StripIdent(s.substr(static_cast<size_t>(i + 1)));
}

bool IsIdentOnly(const std::string& s) {
  for (unsigned char c : s) {
    if (IsIdentCharQuoted(c) || c == '.' || IsAsciiSpace(c)) continue;
    return false;
  }
  return true;
}

bool HasTrailingClause(const std::string& lower, const std::vector<std::string>& markers) {
  std::string trimmed = lower;
  while (!trimmed.empty() && IsAsciiSpace(static_cast<unsigned char>(trimmed.back()))) {
    trimmed.pop_back();
  }
  for (std::string m : markers) {
    m = TrimSpace(m);
    if (m.empty()) continue;
    size_t idx = trimmed.rfind(m);
    if (idx == std::string::npos) {
      if (trimmed.size() >= m.size() + 1 &&
          trimmed.compare(trimmed.size() - m.size() - 1, m.size() + 1, " " + m) == 0) {
        return true;
      }
      if (trimmed.size() >= m.size() && trimmed.compare(trimmed.size() - m.size(), m.size(), m) == 0) {
        return true;
      }
      continue;
    }
    const std::string after = TrimSpace(trimmed.substr(idx + m.size()));
    if (after.empty() || IsIdentOnly(after)) return true;
  }
  return false;
}

bool InCallClause(const std::string& lower) {
  const size_t idx = lower.rfind("call");
  if (idx == std::string::npos) return false;
  if (idx > 0) {
    const unsigned char prev = static_cast<unsigned char>(lower[idx - 1]);
    if (IsIdentPart(prev)) return false;
  }
  const std::string rest = TrimSpace(lower.substr(idx + 4));
  if (rest.empty()) return true;
  for (unsigned char c : rest) {
    if (c == '(') return false;
    if (IsIdentPart(c) || c == '`' || c == '"' || c == '.' || IsAsciiSpace(c)) continue;
    return false;
  }
  return true;
}

bool InSelectList(const std::string& lower) {
  const size_t sel = lower.rfind("select");
  if (sel == std::string::npos) return false;
  const std::string after = lower.substr(sel + 6);
  // 顶层尚未出现 from/where…
  size_t depth = 0;
  for (size_t i = 0; i + 4 < after.size(); ++i) {
    if (after[i] == '(') ++depth;
    else if (after[i] == ')') {
      if (depth > 0) --depth;
    } else if (depth == 0) {
      if (after.compare(i, 5, " from") == 0) return false;
      if (after.compare(i, 6, " where") == 0) return false;
    }
  }
  // select 后有内容或空白
  return true;
}

}  // namespace

int OffsetFromPosition(const std::string& text, Position pos) {
  int line = pos.line < 0 ? 0 : pos.line;
  int col = pos.character < 0 ? 0 : pos.character;
  int cur_line = 0;
  size_t i = 0;
  while (i < text.size()) {
    if (cur_line == line) {
      int remain = col;
      while (i < text.size() && text[i] != '\n' && remain > 0) {
        const unsigned char c = static_cast<unsigned char>(text[i]);
        if (c == '\r') {
          ++i;
          continue;
        }
        // 简化：多字节 UTF-8 按 1 个 UTF-16 unit（BMP 足够覆盖标识符）
        size_t size = 1;
        if (c >= 0xF0) size = 4;
        else if (c >= 0xE0) size = 3;
        else if (c >= 0xC0) size = 2;
        remain -= 1;
        i += size;
      }
      return static_cast<int>(i);
    }
    if (text[i] == '\n') {
      ++cur_line;
      ++i;
      continue;
    }
    const unsigned char c = static_cast<unsigned char>(text[i]);
    if (c >= 0xF0) i += 4;
    else if (c >= 0xE0) i += 3;
    else if (c >= 0xC0) i += 2;
    else ++i;
  }
  return static_cast<int>(text.size());
}

std::string IdentPrefixAt(const std::string& text, int offset) {
  if (offset > static_cast<int>(text.size())) offset = static_cast<int>(text.size());
  int i = offset - 1;
  while (i >= 0 && IsIdentCharQuoted(static_cast<unsigned char>(text[static_cast<size_t>(i)]))) {
    --i;
  }
  return StripIdent(text.substr(static_cast<size_t>(i + 1), static_cast<size_t>(offset - i - 1)));
}

std::vector<TableRef> ExtractTableRefs(const std::string& text, int offset) {
  int start = 0;
  std::string stmt;
  CurrentStatementSpan(text, offset, start, stmt);
  if (TrimSpace(stmt).empty()) return {};
  return ScanTableRefs(stmt);
}

bool ResolveDotQualifier(const std::vector<TableRef>& refs, const std::string& name_in,
                         const std::string& default_db, std::string& schema, std::string& table) {
  const std::string name = StripIdent(name_in);
  if (name.empty()) return false;
  const std::string lower = ToLower(name);
  for (const auto& r : refs) {
    if (!r.alias.empty() && ToLower(r.alias) == lower) {
      schema = CoalesceSchema(r.schema, default_db);
      table = r.name;
      return true;
    }
  }
  for (const auto& r : refs) {
    if (ToLower(r.name) == lower) {
      schema = CoalesceSchema(r.schema, default_db);
      table = r.name;
      return true;
    }
  }
  return false;
}

CompletionContext HeuristicCompletionContext(const std::string& text, Position pos,
                                             const std::vector<std::string>& keywords) {
  const int offset = OffsetFromPosition(text, pos);
  const std::string prefix = IdentPrefixAt(text, offset);
  int stmt_start = 0;
  std::string stmt;
  CurrentStatementSpan(text, offset, stmt_start, stmt);
  int rel = offset - stmt_start;
  if (rel < 0) rel = 0;
  if (rel > static_cast<int>(stmt.size())) rel = static_cast<int>(stmt.size());
  const std::string before = stmt.substr(0, static_cast<size_t>(rel));
  const std::string lower = ToLower(before);

  CompletionContext cc;
  cc.prefix = prefix;
  cc.keywords = keywords;
  cc.tables = ExtractTableRefs(text, offset);

  std::string dot_schema;
  std::string rest;
  if (SplitTrailingDotIdent(before, dot_schema, rest)) {
    std::string table2;
    std::string col_prefix;
    const std::string before_left = before.substr(0, before.size() - rest.size() - 1);
    if (SplitTrailingDotIdent(before_left, table2, col_prefix)) {
      cc.schema = StripIdent(dot_schema);
      cc.table = StripIdent(rest);
      cc.prefix = col_prefix.empty() ? prefix : StripIdent(col_prefix);
      cc.expect = {CompletionKind::Column};
      return cc;
    }
    const std::string name = StripIdent(dot_schema);
    if (InCallClause(lower)) {
      cc.schema = name;
      cc.expect = {CompletionKind::Routine};
      return cc;
    }
    std::string sch;
    std::string tbl;
    if (ResolveDotQualifier(cc.tables, name, "", sch, tbl)) {
      cc.schema = sch;
      cc.table = tbl;
      cc.expect = {CompletionKind::Column};
      return cc;
    }
    cc.schema = name;
    cc.table = name;
    cc.expect = {CompletionKind::Table, CompletionKind::Column};
    return cc;
  }

  if (InCallClause(lower)) {
    cc.expect = {CompletionKind::Routine, CompletionKind::Schema, CompletionKind::Keyword};
    return cc;
  }

  const size_t set_idx = lower.rfind(" set ");
  if (set_idx != std::string::npos) {
    const std::string head = TrimSpace(before.substr(0, set_idx));
    const std::string table = LastIdent(head);
    if (!table.empty()) {
      cc.table = table;
      std::string sch;
      std::string tbl;
      if (SplitQual(table, sch, tbl)) {
        cc.schema = sch;
        cc.table = tbl;
      } else if (ResolveDotQualifier(cc.tables, table, "", sch, tbl)) {
        cc.schema = sch;
        cc.table = tbl;
      }
      cc.expect = {CompletionKind::Column, CompletionKind::Function, CompletionKind::Routine,
                   CompletionKind::Keyword};
      cc.routine_filter = "function";
      return cc;
    }
  }

  if (HasTrailingClause(lower, {" where ", " having ", " on ", " and ", " or ", " group by ",
                                " order by ", " connect by ", " start with ", " partition by ",
                                " over ", " returning "})) {
    cc.expect = {CompletionKind::Column, CompletionKind::Function, CompletionKind::Routine,
                 CompletionKind::Keyword, CompletionKind::Schema};
    cc.routine_filter = "function";
    return cc;
  }

  if (HasTrailingClause(lower, {" from ", " join ", " into ", " update ", " table ", " tables ",
                                " merge ", " using "})) {
    cc.expect = {CompletionKind::Table, CompletionKind::Schema, CompletionKind::Keyword};
    return cc;
  }

  if (InSelectList(lower)) {
    cc.expect = {CompletionKind::Column, CompletionKind::Function, CompletionKind::Routine,
                 CompletionKind::Keyword, CompletionKind::Schema, CompletionKind::Table};
    cc.routine_filter = "function";
    return cc;
  }

  cc.expect = {CompletionKind::Keyword, CompletionKind::Function, CompletionKind::Schema,
               CompletionKind::Table};
  return cc;
}

}  // namespace niuma::sqllsp
