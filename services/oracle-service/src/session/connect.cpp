#include "session/connect.hpp"

#include "util/ident.hpp"
#include "util/paths.hpp"
#include "util/stmt_guard.hpp"

#include <cctype>
#include <cstring>
#include <mutex>
#include <sstream>

namespace niuma::oracle::session {
namespace {

std::mutex g_ctx_mu;
ContextPtr g_ctx;

std::string DpiError(const dpiContext* ctx, const dpiErrorInfo* info = nullptr) {
  dpiErrorInfo local{};
  if (info == nullptr && ctx != nullptr) {
    dpiContext_getError(ctx, &local);
    info = &local;
  }
  if (info == nullptr || info->message == nullptr) {
    return "oracle: unknown ODPI error";
  }
  std::ostringstream oss;
  oss << "oracle: " << info->message;
  if (info->code != 0) {
    oss << " (ORA-" << info->code << ")";
  }
  return oss.str();
}

std::string JsonString(const nlohmann::json& j, std::initializer_list<const char*> keys) {
  for (const char* k : keys) {
    if (j.contains(k) && j[k].is_string()) {
      return j[k].get<std::string>();
    }
  }
  return {};
}

int JsonInt(const nlohmann::json& j, std::initializer_list<const char*> keys, int def) {
  for (const char* k : keys) {
    if (j.contains(k) && j[k].is_number_integer()) {
      return j[k].get<int>();
    }
  }
  return def;
}

}  // namespace

ConnectParams ConnectParams::FromJson(const nlohmann::json& j) {
  ConnectParams p;
  p.host_address = JsonString(j, {"hostAddress", "host"});
  p.port_number = JsonInt(j, {"portNumber", "port"}, 1521);
  p.login_account = JsonString(j, {"loginAccount", "user"});
  p.secret = JsonString(j, {"secret", "password"});

  nlohmann::json opts = nlohmann::json::object();
  if (j.contains("options") && j["options"].is_object()) {
    opts = j["options"];
  } else if (j.contains("connectionOptions") && j["connectionOptions"].is_object()) {
    opts = j["connectionOptions"];
  }

  p.options.schema = JsonString(opts, {"schema"});
  p.options.database = JsonString(opts, {"database"});
  p.options.service_name = JsonString(opts, {"service_name", "serviceName"});
  p.options.sid = JsonString(opts, {"sid"});
  p.options.role = JsonString(opts, {"role"});
  p.options.app_name = JsonString(opts, {"application_name", "appName"});
  if (p.options.app_name.empty()) {
    p.options.app_name = "NiuMa";
  }
  p.options.connect_timeout_seconds = JsonInt(opts, {"connect_timeout_seconds"}, 30);
  if (opts.contains("exclude_system_schemas") && opts["exclude_system_schemas"].is_boolean()) {
    p.options.exclude_system_schemas = opts["exclude_system_schemas"].get<bool>();
  } else if (opts.contains("excludeSystemSchemas") && opts["excludeSystemSchemas"].is_boolean()) {
    p.options.exclude_system_schemas = opts["excludeSystemSchemas"].get<bool>();
  }
  // 顶层也可带 service_name（部分表单）
  if (p.options.service_name.empty()) {
    p.options.service_name = JsonString(j, {"service_name", "serviceName"});
  }
  if (p.options.sid.empty()) {
    p.options.sid = JsonString(j, {"sid"});
  }
  return p;
}

std::string ConnectParams::SchemaOrEmpty() const {
  if (!options.schema.empty()) {
    return options.schema;
  }
  return options.database;
}

std::string ConnectParams::BuildConnectString() const {
  const int port = port_number > 0 ? port_number : 1521;
  const int timeout = options.connect_timeout_seconds > 0 ? options.connect_timeout_seconds : 30;
  if (!options.service_name.empty()) {
    // Easy Connect + connect_timeout（秒）
    return host_address + ":" + std::to_string(port) + "/" + options.service_name +
           "?connect_timeout=" + std::to_string(timeout);
  }
  if (!options.sid.empty()) {
    std::ostringstream oss;
    oss << "(DESCRIPTION=(CONNECT_TIMEOUT=" << timeout << ")(ADDRESS=(PROTOCOL=TCP)(HOST=" << host_address
        << ")(PORT=" << port << "))(CONNECT_DATA=(SID=" << options.sid << ")))";
    return oss.str();
  }
  // 默认当 service_name 缺失时仍给 Easy Connect 占位，由驱动报错
  return host_address + ":" + std::to_string(port) + "/ORCL?connect_timeout=" + std::to_string(timeout);
}

ContextPtr SharedContext(std::string& error) {
  std::lock_guard lock(g_ctx_mu);
  if (g_ctx) {
    return g_ctx;
  }
  dpiContextCreateParams params{};
  const std::string lib_dir = util::OracleClientLibDir();
  params.oracleClientLibDir = lib_dir.c_str();

  dpiContext* ctx = nullptr;
  dpiErrorInfo err_info{};
  if (dpiContext_createWithParams(DPI_MAJOR_VERSION, DPI_MINOR_VERSION, &params, &ctx, &err_info) < 0) {
    error = DpiError(nullptr, &err_info);
    error += "; set NIUMA_ORACLE_RUNTIME or place Instant Client under services/bin/runtime/oracle";
    return nullptr;
  }
  g_ctx.reset(ctx, DpiContextDeleter{});
  return g_ctx;
}

namespace {

bool FetchFirstBytes(dpiContext* ctx, dpiConn* conn, const char* sql, std::string& out, std::string& error) {
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(conn, 0, sql, static_cast<uint32_t>(std::strlen(sql)), nullptr, 0, &raw) < 0) {
    error = DpiError(ctx);
    return false;
  }
  stmt.Reset(raw);
  uint32_t num_cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &num_cols) < 0) {
    error = DpiError(ctx);
    return false;
  }
  int found = 0;
  uint32_t buffer_row = 0;
  if (dpiStmt_fetch(stmt.Get(), &found, &buffer_row) < 0) {
    error = DpiError(ctx);
    return false;
  }
  if (!found) {
    return true;
  }
  dpiNativeTypeNum native_type = DPI_NATIVE_TYPE_BYTES;
  dpiData* data = nullptr;
  if (dpiStmt_getQueryValue(stmt.Get(), 1, &native_type, &data) < 0) {
    error = DpiError(ctx);
    return false;
  }
  if (data && !data->isNull && native_type == DPI_NATIVE_TYPE_BYTES) {
    out.assign(reinterpret_cast<const char*>(data->value.asBytes.ptr), data->value.asBytes.length);
  }
  return true;
}

dialect::ServerProfile Probe(dpiContext* ctx, dpiConn* conn, std::string& error) {
  std::string banner;
  if (!FetchFirstBytes(ctx, conn, "SELECT banner FROM v$version WHERE ROWNUM = 1", banner, error)) {
    return {};
  }
  if (banner.empty()) {
    error.clear();
    if (!FetchFirstBytes(ctx, conn, "SELECT banner_full FROM v$version WHERE ROWNUM = 1", banner, error)) {
      return {};
    }
  }

  if (banner.empty()) {
    error = "oracle: empty version banner";
    return {};
  }
  if (dialect::LooksLikeForeignEngine(banner) || !dialect::LooksLikeOracle(banner)) {
    error = "oracle: server is not Oracle Database; use the matching connection kind";
    return {};
  }

  bool cdb = false;
  std::string con;
  std::string ignore;
  if (FetchFirstBytes(ctx, conn, "SELECT SYS_CONTEXT('USERENV','CON_NAME') FROM dual", con, ignore)) {
    cdb = !con.empty();
  }

  return dialect::ResolveCapabilities(banner, cdb);
}

dpiAuthMode AuthMode(const std::string& role) {
  std::string r = role;
  for (char& c : r) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  if (r == "sysdba") {
    return DPI_MODE_AUTH_SYSDBA;
  }
  if (r == "sysoper") {
    return DPI_MODE_AUTH_SYSOPER;
  }
  return DPI_MODE_AUTH_DEFAULT;
}

}  // namespace

OpenedConnection ConnectAndProbe(const ConnectParams& params, std::string& error) {
  OpenedConnection out;
  if (params.host_address.empty()) {
    error = "oracle: host address required";
    return out;
  }
  if (params.login_account.empty()) {
    error = "oracle: login account required";
    return out;
  }

  auto ctx = SharedContext(error);
  if (!ctx) {
    return out;
  }

  const std::string conn_str = params.BuildConnectString();
  dpiConnCreateParams create{};
  dpiContext_initConnCreateParams(ctx.get(), &create);
  create.authMode = AuthMode(params.options.role);

  dpiCommonCreateParams common{};
  dpiContext_initCommonCreateParams(ctx.get(), &common);
  // encoding
  common.encoding = "UTF-8";
  common.nencoding = "UTF-8";

  dpiConn* conn = nullptr;
  if (dpiConn_create(ctx.get(), params.login_account.c_str(),
                     static_cast<uint32_t>(params.login_account.size()), params.secret.c_str(),
                     static_cast<uint32_t>(params.secret.size()), conn_str.c_str(),
                     static_cast<uint32_t>(conn_str.size()), &common, &create, &conn) < 0) {
    error = DpiError(ctx.get());
    return out;
  }
  out.conn.reset(conn);

  if (!params.options.app_name.empty()) {
    dpiConn_setClientInfo(conn, params.options.app_name.c_str(),
                          static_cast<uint32_t>(params.options.app_name.size()));
  }

  const std::string schema = params.SchemaOrEmpty();
  if (!schema.empty() && util::IsSafeIdent(schema)) {
    const std::string alter = "ALTER SESSION SET CURRENT_SCHEMA = " + util::QuoteIdent(schema);
    util::StmtGuard stmt;
    dpiStmt* raw = nullptr;
    if (dpiConn_prepareStmt(conn, 0, alter.c_str(), static_cast<uint32_t>(alter.size()), nullptr, 0, &raw) == 0) {
      stmt.Reset(raw);
      uint32_t cols = 0;
      dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols);
    }
  }

  out.profile = Probe(ctx.get(), conn, error);
  if (!error.empty()) {
    out.conn.reset();
    return {};
  }
  return out;
}

}  // namespace niuma::oracle::session
