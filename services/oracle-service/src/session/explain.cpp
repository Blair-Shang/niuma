#include "session/explain.hpp"

#include "dataio/script_split.hpp"
#include "util/idgen.hpp"
#include "util/sql_literal.hpp"

#include <chrono>
#include <cctype>

namespace niuma::oracle::session {
namespace {

std::string Trim(std::string s) {
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) {
    s.erase(s.begin());
  }
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) {
    s.pop_back();
  }
  return s;
}

}  // namespace

nlohmann::json ExplainQuery(Session& session, const QueryExecParams& params, std::string& error) {
  std::string sql = dataio::StripSqlPlusTerminator(Trim(params.sql));
  if (sql.empty()) {
    error = "oracle: sql required";
    return {};
  }
  const std::string stmt_id = util::NextId("xplan");
  // 清理同 id 的旧 plan（忽略错误）
  {
    std::string ignore;
    QueryExecParams del = params;
    del.sql = "DELETE FROM PLAN_TABLE WHERE STATEMENT_ID = " + util::QuoteLiteral(stmt_id);
    del.request_id = util::NextId("q");
    (void)ExecQuery(session, del, ignore);
  }

  QueryExecParams plan = params;
  plan.sql = "EXPLAIN PLAN SET STATEMENT_ID = " + util::QuoteLiteral(stmt_id) + " FOR\n" + sql;
  plan.request_id = params.request_id.empty() ? util::NextId("q") : params.request_id;
  auto prepare = ExecQuery(session, plan, error);
  if (!error.empty()) {
    return {};
  }
  (void)prepare;

  QueryExecParams display = params;
  display.sql =
      "SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', " +
      util::QuoteLiteral(stmt_id) + ", 'TYPICAL'))";
  display.limit = params.limit > 0 ? params.limit : 5000;
  display.request_id = util::NextId("q");
  auto result = ExecQuery(session, display, error);
  if (!error.empty()) {
    return {};
  }
  result["requestId"] = plan.request_id;
  result["commandTag"] = "EXPLAIN";
  return result;
}

}  // namespace niuma::oracle::session
