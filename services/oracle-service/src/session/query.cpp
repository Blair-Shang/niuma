#include "session/query.hpp"

#include "session/tx.hpp"
#include "util/dpi_error.hpp"
#include "util/idgen.hpp"
#include "util/ident.hpp"
#include "util/lob.hpp"
#include "util/stmt_guard.hpp"

#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstring>

namespace niuma::oracle::session {
namespace {

constexpr int kDefaultLimit = 1000;
constexpr int kMaxLimit = 10000;

int ClampLimit(int limit) {
  if (limit <= 0) {
    return kDefaultLimit;
  }
  return limit > kMaxLimit ? kMaxLimit : limit;
}

std::string DpiError(dpiContext* ctx) {
  return util::FormatDpiError(ctx, "oracle: query error");
}

std::string TypeName(dpiOracleTypeNum oracle_type) {
  switch (oracle_type) {
    case DPI_ORACLE_TYPE_NUMBER:
      return "NUMBER";
    case DPI_ORACLE_TYPE_VARCHAR:
    case DPI_ORACLE_TYPE_NVARCHAR:
    case DPI_ORACLE_TYPE_CHAR:
    case DPI_ORACLE_TYPE_NCHAR:
      return "VARCHAR2";
    case DPI_ORACLE_TYPE_DATE:
      return "DATE";
    case DPI_ORACLE_TYPE_TIMESTAMP:
    case DPI_ORACLE_TYPE_TIMESTAMP_TZ:
    case DPI_ORACLE_TYPE_TIMESTAMP_LTZ:
      return "TIMESTAMP";
    case DPI_ORACLE_TYPE_CLOB:
    case DPI_ORACLE_TYPE_NCLOB:
      return "CLOB";
    case DPI_ORACLE_TYPE_BLOB:
      return "BLOB";
    case DPI_ORACLE_TYPE_RAW:
      return "RAW";
    case DPI_ORACLE_TYPE_JSON:
      return "JSON";
    default:
      return "OTHER";
  }
}

nlohmann::json CellToJson(dpiContext* ctx, dpiOracleTypeNum oracle_type, dpiNativeTypeNum native,
                          dpiData* data) {
  if (data == nullptr || data->isNull) {
    return nullptr;
  }
  if (native == DPI_NATIVE_TYPE_LOB || oracle_type == DPI_ORACLE_TYPE_CLOB ||
      oracle_type == DPI_ORACLE_TYPE_NCLOB || oracle_type == DPI_ORACLE_TYPE_BLOB ||
      oracle_type == DPI_ORACLE_TYPE_BFILE) {
    return util::LobCellToJson(ctx, oracle_type, native, data);
  }
  switch (native) {
    case DPI_NATIVE_TYPE_INT64:
      return data->value.asInt64;
    case DPI_NATIVE_TYPE_UINT64:
      return data->value.asUint64;
    case DPI_NATIVE_TYPE_FLOAT:
      return data->value.asFloat;
    case DPI_NATIVE_TYPE_DOUBLE:
      return data->value.asDouble;
    case DPI_NATIVE_TYPE_BYTES:
      if (oracle_type == DPI_ORACLE_TYPE_RAW || oracle_type == DPI_ORACLE_TYPE_LONG_RAW) {
        const std::string raw(reinterpret_cast<const char*>(data->value.asBytes.ptr),
                              data->value.asBytes.length);
        return nlohmann::json{{"$bin", util::Base64Encode(raw)}};
      }
      return std::string(reinterpret_cast<const char*>(data->value.asBytes.ptr), data->value.asBytes.length);
    case DPI_NATIVE_TYPE_BOOLEAN:
      return static_cast<bool>(data->value.asBoolean);
    case DPI_NATIVE_TYPE_TIMESTAMP: {
      const auto& t = data->value.asTimestamp;
      char buf[64];
      std::snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d", t.year, t.month, t.day, t.hour, t.minute,
                    t.second);
      return std::string(buf);
    }
    default:
      return nullptr;
  }
}

bool IsSelectLike(const std::string& sql) {
  size_t i = 0;
  while (i < sql.size() && std::isspace(static_cast<unsigned char>(sql[i]))) {
    ++i;
  }
  auto starts = [&](const char* kw) {
    const size_t n = std::strlen(kw);
    if (i + n > sql.size()) {
      return false;
    }
    for (size_t k = 0; k < n; ++k) {
      if (std::tolower(static_cast<unsigned char>(sql[i + k])) != kw[k]) {
        return false;
      }
    }
    return true;
  };
  return starts("select") || starts("with") || starts("show") || starts("describe") || starts("desc");
}

nlohmann::json ReadRow(dpiContext* ctx, dpiStmt* stmt, uint32_t num_cols,
                       const std::vector<dpiOracleTypeNum>& oracle_types, std::string& error) {
  nlohmann::json row = nlohmann::json::array();
  for (uint32_t c = 1; c <= num_cols; ++c) {
    dpiNativeTypeNum native = DPI_NATIVE_TYPE_BYTES;
    dpiData* data = nullptr;
    if (dpiStmt_getQueryValue(stmt, c, &native, &data) < 0) {
      error = DpiError(ctx);
      return row;
    }
    const dpiOracleTypeNum otype =
        c <= oracle_types.size() ? oracle_types[c - 1] : DPI_ORACLE_TYPE_VARCHAR;
    row.push_back(CellToJson(ctx, otype, native, data));
  }
  return row;
}

// 取最多 limit 行；再多取 1 行探测 hasMore，多出来的放进 pending_row（不回传客户端）。
nlohmann::json FetchPage(dpiContext* ctx, dpiStmt* stmt, uint32_t num_cols,
                         const std::vector<dpiOracleTypeNum>& oracle_types, int limit,
                         std::optional<nlohmann::json>& pending_row, bool& has_more, std::string& error) {
  nlohmann::json rows = nlohmann::json::array();
  has_more = false;

  if (pending_row.has_value()) {
    rows.push_back(std::move(*pending_row));
    pending_row.reset();
  }

  while (static_cast<int>(rows.size()) < limit) {
    int found = 0;
    uint32_t buffer_row = 0;
    if (dpiStmt_fetch(stmt, &found, &buffer_row) < 0) {
      error = DpiError(ctx);
      return rows;
    }
    if (!found) {
      has_more = false;
      return rows;
    }
    auto row = ReadRow(ctx, stmt, num_cols, oracle_types, error);
    if (!error.empty()) {
      return rows;
    }
    rows.push_back(std::move(row));
  }

  // 探测是否还有下一行
  int found = 0;
  uint32_t buffer_row = 0;
  if (dpiStmt_fetch(stmt, &found, &buffer_row) < 0) {
    error = DpiError(ctx);
    return rows;
  }
  if (found) {
    auto peeked = ReadRow(ctx, stmt, num_cols, oracle_types, error);
    if (!error.empty()) {
      return rows;
    }
    pending_row = std::move(peeked);
    has_more = true;
  } else {
    has_more = false;
  }
  return rows;
}

void ClearCancel(Session& session) {
  session.cancel_stmt = nullptr;
  session.active_request_id.clear();
}

struct CallTimeoutScope {
  dpiConn* conn = nullptr;
  uint32_t previous = 0;
  bool applied = false;

  CallTimeoutScope(dpiConn* c, int timeout_ms) : conn(c) {
    if (!conn || timeout_ms <= 0) {
      return;
    }
    if (dpiConn_getCallTimeout(conn, &previous) < 0) {
      previous = 0;
    }
    if (dpiConn_setCallTimeout(conn, static_cast<uint32_t>(timeout_ms)) == 0) {
      applied = true;
    }
  }

  ~CallTimeoutScope() {
    if (applied && conn) {
      dpiConn_setCallTimeout(conn, previous);
    }
  }

  CallTimeoutScope(const CallTimeoutScope&) = delete;
  CallTimeoutScope& operator=(const CallTimeoutScope&) = delete;
};

bool SetCurrentSchema(dpiContext* ctx, dpiConn* conn, const std::string& schema, std::string& error) {
  if (schema.empty()) {
    return true;
  }
  if (!util::IsSafeIdent(schema)) {
    error = "oracle: invalid schema name";
    return false;
  }
  const std::string quoted = util::QuoteIdent(schema);
  const std::string alter = "ALTER SESSION SET CURRENT_SCHEMA = " + quoted;
  util::StmtGuard alter_stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(conn, 0, alter.c_str(), static_cast<uint32_t>(alter.size()), nullptr, 0, &raw) < 0) {
    error = DpiError(ctx);
    return false;
  }
  alter_stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(alter_stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    error = DpiError(ctx);
    return false;
  }
  return true;
}

}  // namespace

QueryExecParams QueryExecParams::FromJson(const nlohmann::json& j) {
  QueryExecParams p;
  if (j.contains("sessionId")) {
    p.session_id = j["sessionId"].get<std::string>();
  }
  if (j.contains("schema") && j["schema"].is_string()) {
    p.schema = j["schema"].get<std::string>();
  } else if (j.contains("database") && j["database"].is_string()) {
    p.schema = j["database"].get<std::string>();
  }
  if (j.contains("sql")) {
    p.sql = j["sql"].get<std::string>();
  }
  if (j.contains("limit") && j["limit"].is_number_integer()) {
    p.limit = j["limit"].get<int>();
  }
  if (j.contains("timeoutMs") && j["timeoutMs"].is_number_integer()) {
    p.timeout_ms = j["timeoutMs"].get<int>();
  }
  if (j.contains("requestId") && j["requestId"].is_string()) {
    p.request_id = j["requestId"].get<std::string>();
  }
  return p;
}

nlohmann::json ExecQuery(Session& session, const QueryExecParams& params, std::string& error) {
  const auto started = std::chrono::steady_clock::now();
  std::string sql = params.sql;
  while (!sql.empty() && std::isspace(static_cast<unsigned char>(sql.front()))) {
    sql.erase(sql.begin());
  }
  while (!sql.empty() && std::isspace(static_cast<unsigned char>(sql.back()))) {
    sql.pop_back();
  }
  // ODPI/OCI 不接受语句分隔符 `;`（客户端约定）；带着会报 ORA-00922 / ORA-00911。
  // 查询页拆句会去掉分号，树 DDL / 单条 exec 可能仍带尾 `;`。
  if (!sql.empty() && sql.back() == ';') {
    sql.pop_back();
    while (!sql.empty() && std::isspace(static_cast<unsigned char>(sql.back()))) {
      sql.pop_back();
    }
  }
  if (sql.empty()) {
    error = "oracle: sql required";
    return {};
  }
  if (!session.conn) {
    error = "oracle: session has no connection";
    return {};
  }

  auto* ctx = session.ctx.get();
  auto* conn = session.conn.get();
  const int limit = ClampLimit(params.limit);
  std::string request_id = params.request_id.empty() ? util::NextId("q") : params.request_id;

  CallTimeoutScope timeout_scope(conn, params.timeout_ms);

  if (!SetCurrentSchema(ctx, conn, params.schema, error)) {
    return {};
  }

  util::StmtGuard stmt;
  {
    dpiStmt* raw = nullptr;
    if (dpiConn_prepareStmt(conn, 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0, &raw) < 0) {
      error = DpiError(ctx);
      return {};
    }
    stmt.Reset(raw);
  }

  {
    std::lock_guard lock(session.mu);
    session.cancel_stmt = stmt.Get();
    session.active_request_id = request_id;
  }

  uint32_t num_cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &num_cols) < 0) {
    error = DpiError(ctx);
    std::lock_guard lock(session.mu);
    ClearCancel(session);
    return {};
  }

  const auto duration_ms =
      std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();

  nlohmann::json result{
      {"requestId", request_id},
      {"columns", nlohmann::json::array()},
      {"rows", nlohmann::json::array()},
      {"rowCount", 0},
      {"durationMs", duration_ms},
  };

  if (num_cols == 0 || !IsSelectLike(sql)) {
    uint64_t affected = 0;
    dpiStmt_getRowCount(stmt.Get(), &affected);
    result["commandTag"] = "OK";
    result["rowsAffected"] = static_cast<int64_t>(affected);
    {
      std::lock_guard lock(session.mu);
      ClearCancel(session);
    }
    if (!AfterDml(session, error)) {
      return {};
    }
    return result;  // StmtGuard 释放
  }

  nlohmann::json columns = nlohmann::json::array();
  std::vector<std::string> names;
  std::vector<std::string> types;
  std::vector<dpiOracleTypeNum> oracle_types;
  names.reserve(num_cols);
  types.reserve(num_cols);
  oracle_types.reserve(num_cols);
  for (uint32_t i = 1; i <= num_cols; ++i) {
    dpiQueryInfo info{};
    if (dpiStmt_getQueryInfo(stmt.Get(), i, &info) < 0) {
      error = DpiError(ctx);
      std::lock_guard lock(session.mu);
      ClearCancel(session);
      return {};
    }
    std::string name(info.name, info.nameLength);
    std::string typ = TypeName(info.typeInfo.oracleTypeNum);
    names.push_back(name);
    types.push_back(typ);
    oracle_types.push_back(info.typeInfo.oracleTypeNum);
    columns.push_back({{"name", name}, {"dataType", typ}});
  }
  result["columns"] = columns;

  std::optional<nlohmann::json> pending;
  bool has_more = false;
  auto rows = FetchPage(ctx, stmt.Get(), num_cols, oracle_types, limit, pending, has_more, error);
  if (!error.empty()) {
    std::lock_guard lock(session.mu);
    ClearCancel(session);
    return {};
  }
  result["rows"] = rows;
  result["rowCount"] = static_cast<int>(rows.size());
  result["fetchedCount"] = static_cast<int>(rows.size());

  if (has_more) {
    const std::string rs_id = util::NextId("rs");
    ResultSet rs;
    rs.stmt = std::move(stmt);
    rs.column_names = std::move(names);
    rs.column_types = std::move(types);
    rs.column_oracle_types = std::move(oracle_types);
    rs.pending_row = std::move(pending);
    {
      std::lock_guard lock(session.mu);
      session.result_sets[rs_id] = std::move(rs);
      ClearCancel(session);
    }
    result["resultSetId"] = rs_id;
    result["hasMore"] = true;
  } else {
    std::lock_guard lock(session.mu);
    ClearCancel(session);
    result["hasMore"] = false;
  }
  return result;
}

nlohmann::json FetchMore(Session& session, const std::string& result_set_id, int limit, std::string& error) {
  const auto started = std::chrono::steady_clock::now();
  if (!session.ctx || !session.conn) {
    error = "oracle: session has no connection";
    return {};
  }

  dpiStmt* stmt = nullptr;
  uint32_t num_cols = 0;
  std::optional<nlohmann::json> pending;
  std::vector<dpiOracleTypeNum> oracle_types;

  {
    std::lock_guard lock(session.mu);
    auto it = session.result_sets.find(result_set_id);
    if (it == session.result_sets.end() || !it->second.stmt) {
      error = "oracle: result set not found";
      return {};
    }
    auto& rs = it->second;
    stmt = rs.stmt.Get();
    num_cols = static_cast<uint32_t>(rs.column_names.size());
    oracle_types = rs.column_oracle_types;
    pending = std::move(rs.pending_row);
    session.cancel_stmt = stmt;
    session.active_request_id.clear();
  }

  // 不持有 session.mu，以便 CancelQuery 可并发 break
  bool has_more = false;
  auto rows = FetchPage(session.ctx.get(), stmt, num_cols, oracle_types, ClampLimit(limit), pending, has_more,
                        error);
  const auto duration_ms =
      std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();

  std::lock_guard lock(session.mu);
  ClearCancel(session);
  auto it = session.result_sets.find(result_set_id);
  if (it == session.result_sets.end()) {
    // 期间被关闭
    if (error.empty() && !has_more) {
      // ok
    }
    if (!error.empty()) {
      return {};
    }
    return nlohmann::json{
        {"rows", rows},
        {"rowCount", static_cast<int>(rows.size())},
        {"fetchedCount", static_cast<int>(rows.size())},
        {"hasMore", false},
        {"durationMs", duration_ms},
    };
  }

  if (!error.empty()) {
    session.result_sets.erase(it);
    return {};
  }

  nlohmann::json out{
      {"resultSetId", result_set_id},
      {"rows", rows},
      {"rowCount", static_cast<int>(rows.size())},
      {"fetchedCount", static_cast<int>(rows.size())},
      {"hasMore", has_more},
      {"durationMs", duration_ms},
  };
  if (!has_more) {
    session.result_sets.erase(it);  // StmtGuard 释放
    out.erase("resultSetId");
  } else {
    it->second.pending_row = std::move(pending);
  }
  return out;
}

bool CloseResultSet(Session& session, const std::string& result_set_id) {
  std::lock_guard lock(session.mu);
  if (result_set_id.empty()) {
    session.result_sets.clear();
    return true;
  }
  auto it = session.result_sets.find(result_set_id);
  if (it == session.result_sets.end()) {
    return false;
  }
  session.result_sets.erase(it);
  return true;
}

bool CancelQuery(Session& session, const std::string& request_id) {
  std::lock_guard lock(session.mu);
  if (!session.conn) {
    return false;
  }
  // 若指定 requestId，则仅取消匹配的活动请求
  if (!request_id.empty() && !session.active_request_id.empty() && request_id != session.active_request_id) {
    return false;
  }
  // ODPI：打断当前连接上的执行（含 fetch）
  return dpiConn_breakExecution(session.conn.get()) == 0;
}

}  // namespace niuma::oracle::session
