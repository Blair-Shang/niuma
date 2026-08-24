#include "meta/metadata_ddl.hpp"

#include "session/sql_rows.hpp"
#include "util/dpi_error.hpp"
#include "util/ident.hpp"
#include "util/lob.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

namespace niuma::oracle::meta {
namespace {

void TrimTrailingWhitespace(std::string& s) {
  while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' ' || s.back() == '\t')) {
    s.pop_back();
  }
}

bool ExecAnonymousPlsql(session::Session& session, const std::string& sql, std::string& error) {
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(session.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0,
                          &raw) < 0) {
    error = util::FormatDpiError(session.ctx.get(), "oracle: failed to prepare metadata session SQL");
    return false;
  }
  stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    error = util::FormatDpiError(session.ctx.get(), "oracle: failed to execute metadata session SQL");
    return false;
  }
  return true;
}

bool ApplyMetadataSessionTransforms(session::Session& session, std::string& error) {
  static const char* kSql = R"SQL(
BEGIN
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', TRUE);
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'STORAGE', FALSE);
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'TABLESPACE', FALSE);
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SEGMENT_ATTRIBUTES', FALSE);
END;)SQL";
  return ExecAnonymousPlsql(session, kSql, error);
}

}  // namespace

bool ResolveDictionaryObject(session::Session& session, const std::string& schema,
                             const std::string& name, const std::string& object_type,
                             std::string& out_owner, std::string& out_name, std::string& error) {
  out_owner.clear();
  out_name.clear();
  const std::string sql =
      "SELECT OWNER, OBJECT_NAME FROM ALL_OBJECTS WHERE UPPER(OWNER) = UPPER(" +
      util::QuoteLiteral(schema) + ") AND OBJECT_TYPE = " + util::QuoteLiteral(object_type) +
      " AND OBJECT_NAME IN (" + util::QuoteLiteral(name) + ", UPPER(" + util::QuoteLiteral(name) +
      ")) ORDER BY CASE WHEN OBJECT_NAME = " + util::QuoteLiteral(name) +
      " THEN 0 ELSE 1 END FETCH FIRST 1 ROWS ONLY";
  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, 2, rows, error) || rows.rows.empty() ||
      rows.rows[0].size() < 2) {
    error = "oracle: object not found: " + object_type + " " + schema + "." + name;
    return false;
  }
  out_owner = rows.rows[0][0];
  out_name = rows.rows[0][1];
  return true;
}

std::string ResolveDictionaryObjectName(session::Session& session, const std::string& schema,
                                        const std::string& name, const std::string& object_type,
                                        std::string& error) {
  std::string owner;
  std::string object_name;
  if (!ResolveDictionaryObject(session, schema, name, object_type, owner, object_name, error)) {
    return {};
  }
  return object_name;
}

bool FetchDbmsMetadataDdl(session::Session& session, const std::string& object_type,
                          const std::string& schema, const std::string& name, std::string& ddl,
                          std::string& error) {
  if (!session.conn || !session.ctx) {
    error = "oracle: session has no connection";
    return false;
  }
  std::string ignore;
  if (!ApplyMetadataSessionTransforms(session, ignore)) {
    ignore.clear();
  }
  const std::string sql = "SELECT DBMS_METADATA.GET_DDL(" + util::QuoteLiteral(object_type) + ", " +
                          util::QuoteLiteral(name) + ", " + util::QuoteLiteral(schema) + ") FROM DUAL";
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(session.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0,
                          &raw) < 0) {
    error = util::FormatDpiError(session.ctx.get(), "oracle: failed to prepare DDL query");
    return false;
  }
  stmt.Reset(raw);
  // ODPI：必须先 execute，再 defineValue，最后 fetch。
  // 若在 execute 前 define CLOB，fetch/读 LOB 常报 ORA-24338（与 DBA 权限无关）。
  uint32_t cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    error = util::FormatDpiError(session.ctx.get(), "oracle: failed to execute DDL query");
    return false;
  }
  if (cols != 1) {
    error = "oracle: DDL query returned unexpected metadata";
    return false;
  }
  if (dpiStmt_defineValue(stmt.Get(), 1, DPI_ORACLE_TYPE_CLOB, DPI_NATIVE_TYPE_LOB, 0, 0, nullptr) < 0) {
    error = util::FormatDpiError(session.ctx.get(), "oracle: failed to define DDL output");
    return false;
  }
  int found = 0;
  uint32_t buffer_row = 0;
  if (dpiStmt_fetch(stmt.Get(), &found, &buffer_row) < 0) {
    error = util::FormatDpiError(session.ctx.get(), "oracle: failed to fetch DDL");
    return false;
  }
  if (!found) {
    error = "oracle: DDL not found for " + object_type + " " + schema + "." + name;
    return false;
  }
  dpiNativeTypeNum native = DPI_NATIVE_TYPE_BYTES;
  dpiData* data = nullptr;
  if (dpiStmt_getQueryValue(stmt.Get(), 1, &native, &data) < 0) {
    error = util::FormatDpiError(session.ctx.get(), "oracle: failed to read DDL value");
    return false;
  }
  std::string lob;
  if (!util::ReadCompleteLob(session.conn.get(), session.ctx.get(), DPI_ORACLE_TYPE_CLOB, native, data,
                             util::kLobFullMax, lob, error)) {
    return false;
  }
  ddl = std::move(lob);
  TrimTrailingWhitespace(ddl);
  if (ddl.empty()) {
    error = "oracle: empty DDL for " + object_type + " " + schema + "." + name;
    return false;
  }
  return true;
}

}  // namespace niuma::oracle::meta
