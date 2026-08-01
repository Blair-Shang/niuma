#include "dataio/ops.hpp"

#include "session/manager.hpp"

#include "session/connect.hpp"
#include "util/ident.hpp"
#include "util/stmt_guard.hpp"

#include <fstream>
#include <sstream>

namespace niuma::oracle::dataio {
namespace {

bool Canceled(const CancelFlag& cancel) { return cancel && cancel->load(); }

bool OpenIoSession(const session::ConnectParams& connect, session::Session& out, std::string& error) {
  auto opened = session::ConnectAndProbe(connect, error);
  if (!opened.conn) {
    return false;
  }
  out.conn = std::move(opened.conn);
  out.ctx = session::SharedContext(error);
  out.params = connect;
  out.profile = std::move(opened.profile);
  return out.conn && out.ctx;
}

std::string Trim(std::string s) {
  while (!s.empty() && (s.front() == ' ' || s.front() == '\t' || s.front() == '\r' || s.front() == '\n')) {
    s.erase(s.begin());
  }
  while (!s.empty() && (s.back() == ' ' || s.back() == '\t' || s.back() == '\r' || s.back() == '\n')) {
    s.pop_back();
  }
  return s;
}

bool ExecSimple(session::Session& s, const std::string& sql, std::string& error) {
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(s.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0,
                          &raw) < 0) {
    dpiErrorInfo info{};
    dpiContext_getError(s.ctx.get(), &info);
    error = info.message ? std::string("oracle: ") + info.message : "oracle: exec failed";
    return false;
  }
  stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    dpiErrorInfo info{};
    dpiContext_getError(s.ctx.get(), &info);
    error = info.message ? std::string("oracle: ") + info.message : "oracle: exec failed";
    return false;
  }
  return true;
}

// 简易拆句：独立行 `/` 为批边界；否则按 `;` 分（PL/SQL 块可能不完美，P4 可用）。
std::vector<std::string> SplitSqlScript(const std::string& text) {
  std::vector<std::string> stmts;
  std::string cur;
  std::istringstream iss(text);
  std::string line;
  while (std::getline(iss, line)) {
    std::string t = Trim(line);
    if (t == "/") {
      auto s = Trim(cur);
      if (!s.empty()) {
        stmts.push_back(s);
      }
      cur.clear();
      continue;
    }
    cur.append(line);
    cur.push_back('\n');
    // 非 PL/SQL：行尾 ; 结束
    if (!t.empty() && t.back() == ';' && t.find("BEGIN") == std::string::npos &&
        t.find("DECLARE") == std::string::npos && t.rfind("END", 0) != 0) {
      // 若整段含 BEGIN/AS/IS 则等 /
      const std::string upper = cur;
      bool plsql = upper.find("BEGIN") != std::string::npos || upper.find(" CREATE OR REPLACE PACKAGE") != std::string::npos ||
                   upper.find("CREATE OR REPLACE PROCEDURE") != std::string::npos ||
                   upper.find("CREATE OR REPLACE FUNCTION") != std::string::npos;
      if (!plsql) {
        auto s = Trim(cur);
        if (!s.empty() && s.back() == ';') {
          s.pop_back();
        }
        s = Trim(s);
        if (!s.empty()) {
          stmts.push_back(s);
        }
        cur.clear();
      }
    }
  }
  auto s = Trim(cur);
  if (!s.empty()) {
    if (s.back() == ';') {
      s.pop_back();
      s = Trim(s);
    }
    if (!s.empty()) {
      stmts.push_back(s);
    }
  }
  return stmts;
}

}  // namespace

bool RunExecSqlFile(const session::ConnectParams& connect, const std::string& schema,
                    const std::string& input_path, bool continue_on_error, CancelFlag cancel,
                    ProgressFn progress, std::string& error) {
  session::Session s;
  if (!OpenIoSession(connect, s, error)) {
    return false;
  }
  if (!schema.empty() && util::IsSafeIdent(schema)) {
    const std::string alter =
        "ALTER SESSION SET CURRENT_SCHEMA = " + util::QuoteIdent(schema);
    std::string ignore;
    (void)ExecSimple(s, alter, ignore);
  }

  std::ifstream in(input_path, std::ios::binary);
  if (!in) {
    error = "oracle: cannot open sql file";
    return false;
  }
  std::ostringstream oss;
  oss << in.rdbuf();
  const std::string text = oss.str();
  auto stmts = SplitSqlScript(text);
  int64_t executed = 0;
  int64_t bytes = static_cast<int64_t>(text.size());
  for (const auto& sql : stmts) {
    if (Canceled(cancel)) {
      error = "canceled";
      return false;
    }
    std::string err;
    if (!ExecSimple(s, sql, err)) {
      if (!continue_on_error) {
        error = err;
        return false;
      }
    } else {
      ++executed;
    }
    if (progress && executed % 20 == 0) {
      progress(bytes, executed, "executed " + std::to_string(executed) + " statements");
    }
  }
  dpiConn_commit(s.conn.get());
  if (progress) {
    progress(bytes, executed, "executed " + std::to_string(executed) + " statements total");
  }
  s.Close();
  return true;
}

}  // namespace niuma::oracle::dataio
