#include "meta/monitor.hpp"

#include "session/sql_rows.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

#include <cstdlib>

namespace niuma::oracle::meta {
namespace {

std::string DpiError(dpiContext* ctx) {
  dpiErrorInfo info{};
  if (ctx) {
    dpiContext_getError(ctx, &info);
  }
  if (info.message == nullptr) {
    return "oracle: monitor error";
  }
  return std::string("oracle: ") + info.message;
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

}  // namespace

nlohmann::json ListProcesslist(session::Session& session, std::string& error) {
  // SID, SERIAL#, USERNAME, MACHINE, SCHEMANAME, STATUS, LAST_CALL_ET, SQL snippet
  const char* sql =
      "SELECT s.SID, s.SERIAL#, NVL(s.USERNAME,'(background)'), NVL(s.MACHINE,''), "
      "NVL(s.SCHEMANAME,''), NVL(s.STATUS,''), NVL(s.LAST_CALL_ET,0), "
      "SUBSTR(NVL(q.SQL_TEXT,''),1,500) "
      "FROM V$SESSION s "
      "LEFT JOIN V$SQL q ON q.SQL_ID = s.SQL_ID AND q.CHILD_NUMBER = 0 "
      "WHERE s.TYPE = 'USER' "
      "ORDER BY s.LAST_CALL_ET DESC NULLS LAST";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, 2001, rows, error)) {
    // 权限不足时返回空列表
    error.clear();
    return nlohmann::json{{"processes", nlohmann::json::array()}};
  }

  nlohmann::json processes = nlohmann::json::array();
  for (const auto& row : rows.rows) {
    if (row.size() < 2) {
      continue;
    }
    nlohmann::json p{
        {"id", ToI64(row[0])},
        {"serial", ToI64(row[1])},
        {"user", row.size() > 2 ? row[2] : ""},
        {"host", row.size() > 3 ? row[3] : ""},
        {"command", row.size() > 5 ? row[5] : "SESSION"},
        {"time", row.size() > 6 ? ToI64(row[6]) : 0},
    };
    if (row.size() > 4 && !row[4].empty()) {
      p["db"] = row[4];
    }
    if (row.size() > 5 && !row[5].empty()) {
      p["state"] = row[5];
    }
    if (row.size() > 7 && !row[7].empty()) {
      p["info"] = row[7];
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
  std::string schemas = scalar("SELECT COUNT(*) FROM ALL_USERS");
  if (!schemas.empty()) {
    out["databaseCount"] = static_cast<int>(ToI64(schemas));
  }
  std::string processes = scalar("SELECT VALUE FROM v$parameter WHERE NAME = 'processes'");
  if (!processes.empty()) {
    out["maxConnections"] = static_cast<int>(ToI64(processes));
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
  const std::string sql =
      "SELECT w.SID, w.SERIAL#, NVL(w.USERNAME,''), b.SID, NVL(b.USERNAME,''), "
      "NVL(w.EVENT,''), NVL(w.SECONDS_IN_WAIT,0), "
      "SUBSTR(NVL(wq.SQL_TEXT,''),1,300) "
      "FROM V$SESSION w "
      "JOIN V$SESSION b ON b.SID = w.BLOCKING_SESSION "
      "LEFT JOIN V$SQL wq ON wq.SQL_ID = w.SQL_ID AND wq.CHILD_NUMBER = 0 "
      "WHERE w.BLOCKING_SESSION IS NOT NULL "
      "FETCH FIRST " +
      std::to_string(limit + 1) + " ROWS ONLY";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, limit + 1, rows, error)) {
    error.clear();
    return nlohmann::json{{"locks", nlohmann::json::array()},
                          {"unavailable", true},
                          {"message", "oracle: locks view unavailable or insufficient privilege"}};
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
        {"blockingUser", row.size() > 4 ? row[4] : ""},
        {"lockType", row.size() > 5 ? row[5] : ""},
        {"waitAgeSeconds", row.size() > 6 ? ToI64(row[6]) : 0},
    };
    if (row.size() > 7 && !row[7].empty()) {
      lock["waitingQuery"] = row[7];
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
