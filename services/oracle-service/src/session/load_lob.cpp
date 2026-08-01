#include "session/load_lob.hpp"

#include "util/ident.hpp"
#include "util/lob.hpp"
#include "util/stmt_guard.hpp"

#include <cctype>

namespace niuma::oracle::session {
namespace {

std::string DpiError(dpiContext* ctx) {
  dpiErrorInfo info{};
  if (ctx) {
    dpiContext_getError(ctx, &info);
  }
  if (info.message == nullptr) {
    return "oracle: loadLob error";
  }
  return std::string("oracle: ") + info.message;
}

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

LoadLobParams LoadLobParams::FromJson(const nlohmann::json& j) {
  LoadLobParams p;
  if (j.contains("sessionId")) {
    p.session_id = j["sessionId"].get<std::string>();
  }
  if (j.contains("schema") && j["schema"].is_string()) {
    p.schema = j["schema"].get<std::string>();
  }
  if (j.contains("sql") && j["sql"].is_string()) {
    p.sql = j["sql"].get<std::string>();
  }
  if (j.contains("maxBytes") && j["maxBytes"].is_number_integer()) {
    p.max_bytes = j["maxBytes"].get<int64_t>();
  }
  return p;
}

nlohmann::json LoadLob(Session& session, const LoadLobParams& params, std::string& error) {
  std::string sql = Trim(params.sql);
  if (sql.empty()) {
    error = "oracle: sql required";
    return {};
  }
  if (!session.conn || !session.ctx) {
    error = "oracle: session has no connection";
    return {};
  }

  if (!params.schema.empty() && util::IsSafeIdent(params.schema)) {
    const std::string alter =
        "ALTER SESSION SET CURRENT_SCHEMA = " + util::QuoteIdent(params.schema);
    util::StmtGuard alter_stmt;
    dpiStmt* raw = nullptr;
    if (dpiConn_prepareStmt(session.conn.get(), 0, alter.c_str(), static_cast<uint32_t>(alter.size()),
                            nullptr, 0, &raw) == 0) {
      alter_stmt.Reset(raw);
      uint32_t cols = 0;
      dpiStmt_execute(alter_stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols);
    }
  }

  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(session.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0,
                          &raw) < 0) {
    error = DpiError(session.ctx.get());
    return {};
  }
  stmt.Reset(raw);
  uint32_t num_cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &num_cols) < 0) {
    error = DpiError(session.ctx.get());
    return {};
  }
  if (num_cols < 1) {
    error = "oracle: loadLob expects a single-column SELECT";
    return {};
  }
  int found = 0;
  uint32_t buffer_row = 0;
  if (dpiStmt_fetch(stmt.Get(), &found, &buffer_row) < 0) {
    error = DpiError(session.ctx.get());
    return {};
  }
  if (!found) {
    error = "oracle: loadLob: no row";
    return {};
  }

  dpiQueryInfo info{};
  dpiOracleTypeNum oracle_type = DPI_ORACLE_TYPE_CLOB;
  if (dpiStmt_getQueryInfo(stmt.Get(), 1, &info) == 0) {
    oracle_type = info.typeInfo.oracleTypeNum;
  }
  dpiNativeTypeNum native = DPI_NATIVE_TYPE_BYTES;
  dpiData* data = nullptr;
  if (dpiStmt_getQueryValue(stmt.Get(), 1, &native, &data) < 0) {
    error = DpiError(session.ctx.get());
    return {};
  }
  if (data == nullptr || data->isNull) {
    return nlohmann::json{{"value", nullptr}, {"truncated", false}, {"type", "NULL"}, {"byteLength", 0}};
  }

  const uint64_t max_bytes =
      params.max_bytes > 0 ? static_cast<uint64_t>(params.max_bytes) : util::kLobFullMax;
  util::LobReadResult lob;
  if (!util::ReadLobData(session.ctx.get(), native, data, max_bytes, lob, error)) {
    return {};
  }
  const bool binary =
      oracle_type == DPI_ORACLE_TYPE_BLOB || oracle_type == DPI_ORACLE_TYPE_RAW ||
      oracle_type == DPI_ORACLE_TYPE_LONG_RAW;
  nlohmann::json out{
      {"truncated", lob.truncated},
      {"byteLength", lob.total_size},
      {"type", binary ? "BLOB" : "CLOB"},
  };
  if (binary) {
    out["value"] = nlohmann::json{{"$bin", util::Base64Encode(lob.data)}};
  } else {
    out["value"] = lob.data;
  }
  return out;
}

}  // namespace niuma::oracle::session
