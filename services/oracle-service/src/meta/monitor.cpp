#include "meta/monitor.hpp"

#include "session/sql_rows.hpp"
#include "util/dpi_error.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

#include <cstdlib>

namespace niuma::oracle::meta {
namespace {

std::string DpiError(dpiContext* ctx) {
  return util::FormatDpiError(ctx, "oracle: monitor error");
}

bool ExecNoResult(session::Session& session, const std::string& sql, std::string& error) {
  if (!session.conn || !session.ctx) {
    error = "oracle: session has no connection";
    return false;
  }
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(session.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0,
                          &raw) < 0) {
    error = DpiError(session.ctx.get());
    return false;
  }
  stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    error = DpiError(session.ctx.get());
    return false;
  }
  return true;
}

int64_t ToI64(const std::string& s) {
  try {
    return std::stoll(s);
  } catch (...) {
    return 0;
  }
}

/** Oracle V$LOCK LMODE / REQUEST → 可读模式名。 */
std::string LockModeName(int64_t mode) {
  switch (mode) {
    case 0:
      return "None";
    case 1:
      return "Null";
    case 2:
      return "Row-S (SS)";
    case 3:
      return "Row-X (SX)";
    case 4:
      return "Share (S)";
    case 5:
      return "S/Row-X (SSX)";
    case 6:
      return "Exclusive (X)";
    default:
      return mode > 0 ? std::to_string(mode) : "";
  }
}

/** 会话列表 SELECT 列 8：当前 SQL 文本（表达式，可替换为降级空串）。 */
std::string ProcesslistSqlTextExpr(const char* source_view) {
  return std::string("SUBSTR(NVL((SELECT sq.SQL_TEXT FROM ") + source_view +
         " sq WHERE sq.SQL_ID = s.SQL_ID AND ROWNUM = 1),''),1,500)";
}

std::string BuildProcesslistSQL(const std::string& sql_text_expr) {
  return "SELECT s.SID, s.SERIAL#, NVL(s.USERNAME,'(background)'), NVL(s.MACHINE,''), "
         "NVL(s.SCHEMANAME,''), NVL(s.STATUS,''), NVL(s.LAST_CALL_ET,0), " +
         sql_text_expr +
         ", NVL(s.EVENT,''), NVL(s.SQL_ID,''), NVL(s.WAIT_CLASS,''), s.BLOCKING_SESSION "
         "FROM V$SESSION s "
         "WHERE s.TYPE = 'USER' "
         "ORDER BY s.LAST_CALL_ET DESC NULLS LAST";
}

/** 依次尝试 V$SQLAREA / V$SQL / 无 SQL 文本；避免无 V$SQL 权限时整表失败。 */
bool ExecProcesslist(session::Session& session, session::SqlRowsResult& rows, std::string& error) {
  const std::string attempts[] = {
      BuildProcesslistSQL(ProcesslistSqlTextExpr("V$SQLAREA")),
      BuildProcesslistSQL(ProcesslistSqlTextExpr("V$SQL")),
      BuildProcesslistSQL("CAST('' AS VARCHAR2(500))"),
  };
  std::string last_err;
  for (const auto& sql : attempts) {
    rows = {};
    error.clear();
    if (session::ExecStringRows(session, sql, 2001, rows, error)) {
      return true;
    }
    last_err = error;
  }
  error = last_err;
  return false;
}

std::string LocksWaitingQueryExpr(const char* source_view) {
  return std::string("SUBSTR(NVL((SELECT sq.SQL_TEXT FROM ") + source_view +
         " sq WHERE sq.SQL_ID = w.SQL_ID AND ROWNUM = 1),''),1,300)";
}

std::string BuildLocksSQL(const std::string& waiting_query_expr, int limit, bool with_enqueue) {
  if (with_enqueue) {
    return "SELECT w.SID, w.SERIAL#, NVL(w.USERNAME,''), b.SID, b.SERIAL#, NVL(b.USERNAME,''), "
           "NVL(w.EVENT,''), NVL(w.WAIT_CLASS,''), NVL(w.SECONDS_IN_WAIT,0), " +
           waiting_query_expr +
           ", NVL(l.TYPE,''), "
           "CASE WHEN NVL(l.REQUEST,0) > 0 THEN l.REQUEST ELSE NVL(l.LMODE,0) END, "
           "CASE WHEN o.OWNER IS NOT NULL THEN o.OWNER || '.' || o.OBJECT_NAME ELSE '' END "
           "FROM V$SESSION w "
           "JOIN V$SESSION b ON b.SID = w.BLOCKING_SESSION "
           "LEFT JOIN V$LOCK l ON l.SID = w.SID AND l.REQUEST > 0 "
           "LEFT JOIN ALL_OBJECTS o ON l.TYPE = 'TM' AND o.OBJECT_ID = l.ID1 "
           "WHERE w.BLOCKING_SESSION IS NOT NULL "
           "FETCH FIRST " +
           std::to_string(limit + 1) + " ROWS ONLY";
  }
  return "SELECT w.SID, w.SERIAL#, NVL(w.USERNAME,''), b.SID, b.SERIAL#, NVL(b.USERNAME,''), "
         "NVL(w.EVENT,''), NVL(w.WAIT_CLASS,''), NVL(w.SECONDS_IN_WAIT,0), " +
         waiting_query_expr +
         ", CAST(NULL AS VARCHAR2(10)), CAST(NULL AS NUMBER), CAST(NULL AS VARCHAR2(1)) "
         "FROM V$SESSION w "
         "JOIN V$SESSION b ON b.SID = w.BLOCKING_SESSION "
         "WHERE w.BLOCKING_SESSION IS NOT NULL "
         "FETCH FIRST " +
         std::to_string(limit + 1) + " ROWS ONLY";
}

bool ExecLocksQuery(session::Session& session, int limit, session::SqlRowsResult& rows,
                    std::string& error) {
  const std::string no_sql = "CAST('' AS VARCHAR2(300))";
  const std::string area = LocksWaitingQueryExpr("V$SQLAREA");
  const std::string vsql = LocksWaitingQueryExpr("V$SQL");
  const struct {
    std::string query_expr;
    bool enqueue;
  } attempts[] = {
      {area, true},  {vsql, true},  {no_sql, true},
      {area, false}, {vsql, false}, {no_sql, false},
  };
  std::string last_err;
  for (const auto& a : attempts) {
    rows = {};
    error.clear();
    const std::string sql = BuildLocksSQL(a.query_expr, limit, a.enqueue);
    if (session::ExecStringRows(session, sql, limit + 1, rows, error)) {
      return true;
    }
    last_err = error;
  }
  error = last_err;
  return false;
}

}  // namespace

nlohmann::json ListProcesslist(session::Session& session, std::string& error) {
  session::SqlRowsResult rows;
  if (!ExecProcesslist(session, rows, error)) {
    // 无 V$SESSION 权限时明确告知前端，避免被当成「空进程列表」
    const std::string msg = error.empty()
                                ? "oracle: processlist unavailable or insufficient privilege"
                                : error;
    error.clear();
    return nlohmann::json{{"processes", nlohmann::json::array()},
                          {"unavailable", true},
                          {"message", msg}};
  }

  nlohmann::json processes = nlohmann::json::array();
  for (const auto& row : rows.rows) {
    if (row.size() < 2) {
      continue;
    }
    // command = STATUS（ACTIVE / INACTIVE）；state = 等待事件 EVENT
    const std::string status = row.size() > 5 && !row[5].empty() ? row[5] : "UNKNOWN";
    nlohmann::json p{
        {"id", ToI64(row[0])},
        {"serial", ToI64(row[1])},
        {"user", row.size() > 2 ? row[2] : ""},
        {"host", row.size() > 3 ? row[3] : ""},
        {"command", status},
        {"time", row.size() > 6 ? ToI64(row[6]) : 0},
    };
    if (row.size() > 4 && !row[4].empty()) {
      p["db"] = row[4];
    }
    if (row.size() > 8 && !row[8].empty()) {
      p["state"] = row[8];
    } else {
      p["state"] = status;
    }
    if (row.size() > 7 && !row[7].empty()) {
      p["info"] = row[7];
    }
    if (row.size() > 9 && !row[9].empty()) {
      p["sqlId"] = row[9];
    }
    if (row.size() > 10 && !row[10].empty()) {
      p["waitClass"] = row[10];
    }
    if (row.size() > 11 && !row[11].empty()) {
      const int64_t blocker = ToI64(row[11]);
      if (blocker > 0) {
        p["blockingSession"] = blocker;
      }
    }
    processes.push_back(std::move(p));
  }
  return nlohmann::json{{"processes", processes}};
}

nlohmann::json KillSession(session::Session& session, int64_t sid, int64_t serial, bool query_only,
                           std::string& error) {
  if (sid <= 0) {
    error = "oracle: kill: invalid id";
    return {};
  }
  if (serial <= 0) {
    // 尝试从 V$SESSION 查 serial
    const std::string q =
        "SELECT SERIAL# FROM V$SESSION WHERE SID = " + std::to_string(sid) + " AND ROWNUM = 1";
    session::SqlRowsResult rows;
    std::string ignore;
    if (session::ExecStringRows(session, q, 2, rows, ignore) && !rows.rows.empty() &&
        !rows.rows[0].empty()) {
      serial = ToI64(rows.rows[0][0]);
    }
  }
  if (serial <= 0) {
    error = "oracle: kill: serial# required";
    return {};
  }
  const std::string target = "'" + std::to_string(sid) + "," + std::to_string(serial) + "'";
  std::string sql;
  if (query_only) {
    sql = "ALTER SYSTEM CANCEL SQL " + target;
  } else {
    sql = "ALTER SYSTEM KILL SESSION " + target + " IMMEDIATE";
  }
  if (!ExecNoResult(session, sql, error)) {
    if (query_only) {
      // CANCEL SQL 可能不可用，降级 kill
      error.clear();
      sql = "ALTER SYSTEM KILL SESSION " + target + " IMMEDIATE";
      if (!ExecNoResult(session, sql, error)) {
        return {};
      }
      query_only = false;
    } else {
      return {};
    }
  }
  return nlohmann::json{{"killed", true}, {"id", sid}, {"serial", serial}, {"queryOnly", query_only}};
}

nlohmann::json InstanceOverview(session::Session& session, std::string& error) {
  nlohmann::json out{{"databaseCount", 0}, {"threadsConnected", 0}};
  nlohmann::json warnings = nlohmann::json::array();

  auto scalar = [&](const std::string& sql) -> std::string {
    session::SqlRowsResult rows;
    std::string ignore;
    if (!session::ExecStringRows(session, sql, 2, rows, ignore) || rows.rows.empty() ||
        rows.rows[0].empty()) {
      return {};
    }
    return rows.rows[0][0];
  };

  std::string ver = scalar("SELECT banner FROM v$version WHERE ROWNUM = 1");
  if (!ver.empty()) {
    out["version"] = ver;
  } else {
    warnings.push_back("version unavailable");
  }

  std::string user = scalar("SELECT USER FROM dual");
  if (!user.empty()) {
    out["currentUser"] = user;
  }
  std::string pdb = scalar("SELECT SYS_CONTEXT('USERENV','CON_NAME') FROM dual");
  if (!pdb.empty()) {
    out["currentDatabase"] = pdb;
  }
  std::string inst = scalar("SELECT INSTANCE_NAME FROM v$instance");
  if (!inst.empty()) {
    out["versionComment"] = inst;
  }
  std::string uptime = scalar(
      "SELECT ROUND((SYSDATE - STARTUP_TIME)*86400) FROM v$instance");
  if (!uptime.empty()) {
    out["uptimeSeconds"] = ToI64(uptime);
  }
  std::string sessions = scalar("SELECT COUNT(*) FROM v$session WHERE TYPE = 'USER'");
  if (!sessions.empty()) {
    out["threadsConnected"] = static_cast<int>(ToI64(sessions));
  }
  std::string active = scalar(
      "SELECT COUNT(*) FROM v$session WHERE TYPE = 'USER' AND STATUS = 'ACTIVE'");
  if (!active.empty()) {
    out["activeSessions"] = static_cast<int>(ToI64(active));
  }
  std::string schemas = scalar("SELECT COUNT(*) FROM ALL_USERS");
  if (!schemas.empty()) {
    const int n = static_cast<int>(ToI64(schemas));
    out["databaseCount"] = n;
    out["schemaCount"] = n;
  }
  // 会话上限优先 sessions；processes 单独给出，避免与 MySQL max_connections 语义混淆
  std::string max_sessions = scalar("SELECT VALUE FROM v$parameter WHERE NAME = 'sessions'");
  if (!max_sessions.empty()) {
    const int n = static_cast<int>(ToI64(max_sessions));
    out["maxSessions"] = n;
    out["maxConnections"] = n;
  }
  std::string max_processes = scalar("SELECT VALUE FROM v$parameter WHERE NAME = 'processes'");
  if (!max_processes.empty()) {
    out["maxProcesses"] = static_cast<int>(ToI64(max_processes));
    if (!out.contains("maxConnections")) {
      out["maxConnections"] = static_cast<int>(ToI64(max_processes));
    }
  }
  std::string schema = scalar("SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') FROM dual");
  if (!schema.empty()) {
    out["currentSchema"] = schema;
  }
  std::string host = scalar("SELECT SYS_CONTEXT('USERENV','SERVER_HOST') FROM dual");
  if (!host.empty()) {
    out["serverAddr"] = host;
  }
  std::string exec_count = scalar("SELECT VALUE FROM v$sysstat WHERE NAME = 'execute count'");
  if (!exec_count.empty()) {
    out["executeCount"] = ToI64(exec_count);
  }

  if (!warnings.empty()) {
    out["warnings"] = warnings;
    out["statusPartial"] = true;
  }
  error.clear();
  return out;
}

nlohmann::json ListLocks(session::Session& session, int limit, std::string& error) {
  if (limit <= 0) {
    limit = 200;
  }

  // 阻塞会话链 + 可选 enqueue（V$LOCK）与对象名
  session::SqlRowsResult rows;
  if (!ExecLocksQuery(session, limit, rows, error)) {
    const std::string msg =
        error.empty() ? "oracle: locks view unavailable or insufficient privilege" : error;
    error.clear();
    return nlohmann::json{{"locks", nlohmann::json::array()},
                          {"unavailable", true},
                          {"message", msg}};
  }

  nlohmann::json locks = nlohmann::json::array();
  bool truncated = rows.truncated;
  for (const auto& row : rows.rows) {
    if (static_cast<int>(locks.size()) >= limit) {
      truncated = true;
      break;
    }
    if (row.size() < 2) {
      continue;
    }
    nlohmann::json lock{
        {"waitingPid", ToI64(row[0])},
        {"blockingPid", row.size() > 3 ? ToI64(row[3]) : 0},
        {"waitingUser", row.size() > 2 ? row[2] : ""},
        {"blockingUser", row.size() > 5 ? row[5] : ""},
        {"waitAgeSeconds", row.size() > 8 ? ToI64(row[8]) : 0},
    };
    if (row.size() > 1 && !row[1].empty()) {
      lock["waitingSerial"] = ToI64(row[1]);
    }
    if (row.size() > 4 && !row[4].empty()) {
      lock["blockingSerial"] = ToI64(row[4]);
    }
    // lockType 保留为等待事件（与前端「等待事件」列一致）；enqueue 类型单独给出
    if (row.size() > 6 && !row[6].empty()) {
      lock["lockType"] = row[6];
      lock["waitEvent"] = row[6];
    }
    if (row.size() > 7 && !row[7].empty()) {
      lock["waitClass"] = row[7];
    }
    if (row.size() > 9 && !row[9].empty()) {
      lock["waitingQuery"] = row[9];
    }
    if (row.size() > 10 && !row[10].empty()) {
      lock["enqueueType"] = row[10];
    }
    if (row.size() > 11 && !row[11].empty()) {
      const std::string mode = LockModeName(ToI64(row[11]));
      if (!mode.empty() && mode != "None") {
        lock["lockMode"] = mode;
      }
    }
    if (row.size() > 12 && !row[12].empty()) {
      lock["objectName"] = row[12];
    }
    locks.push_back(std::move(lock));
  }
  nlohmann::json out{{"locks", locks}, {"limit", limit}};
  if (truncated) {
    out["truncated"] = true;
  }
  return out;
}

}  // namespace niuma::oracle::meta
