#include "session/connect.hpp"

#include "util/ident.hpp"
#include "util/paths.hpp"
#include "util/stmt_guard.hpp"
#include "util/utf8.hpp"

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
    dpiContext_getError(const_cast<dpiContext*>(ctx), &local);
    info = &local;
  }
  if (info == nullptr || info->message == nullptr || info->messageLength == 0) {
    return "oracle: unknown ODPI error";
  }
  std::string raw(info->message, info->messageLength);
  while (!raw.empty()) {
    const unsigned char c = static_cast<unsigned char>(raw.back());
    if (c == 0 || c == ' ' || c == '\n' || c == '\r' || c == '\t') {
      raw.pop_back();
      continue;
    }
    break;
  }
  return std::string("oracle: ") + util::EnsureUtf8(raw);
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

std::string ToLower(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return s;
}

std::string NormalizeFsPath(std::string path) {
  for (char& c : path) {
    if (c == '\\') {
      c = '/';
    }
  }
  return path;
}

std::string QuoteEasyConnectValue(const std::string& value) {
  std::string out = "\"";
  for (char c : value) {
    if (c == '"') {
      out += "\\\"";
    } else {
      out.push_back(c);
    }
  }
  out.push_back('"');
  return out;
}

}  // namespace

bool ConnectOptions::SslEnabled() const {
  const std::string mode = ToLower(ssl_mode);
  return !mode.empty() && mode != "disable" && mode != "false" && mode != "off";
}

bool ConnectOptions::SslVerify() const {
  const std::string mode = ToLower(ssl_mode);
  return mode == "verify-full" || mode == "verify-ca" || mode == "verify";
}

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
  if (opts.contains("proxy") && opts["proxy"].is_object()) {
    const auto& px = opts["proxy"];
    p.options.proxy.type = JsonString(px, {"type"});
    p.options.proxy.host = JsonString(px, {"host"});
    p.options.proxy.port = JsonInt(px, {"port"}, 0);
    p.options.proxy.username = JsonString(px, {"username", "user"});
    p.options.proxy.password = JsonString(px, {"password"});
  }
  if (opts.contains("tunnel") && opts["tunnel"].is_object()) {
    const auto& tn = opts["tunnel"];
    p.options.tunnel.type = JsonString(tn, {"type"});
    p.options.tunnel.target_host = JsonString(tn, {"targetHost", "target_host"});
    p.options.tunnel.target_port = JsonInt(tn, {"targetPort", "target_port"}, 0);
    if (tn.contains("sshProfile") && tn["sshProfile"].is_object()) {
      const auto& sp = tn["sshProfile"];
      p.options.tunnel.has_ssh_profile = true;
      p.options.tunnel.ssh_profile.host_address = JsonString(sp, {"hostAddress", "host"});
      p.options.tunnel.ssh_profile.port_number = JsonInt(sp, {"portNumber", "port"}, 22);
      p.options.tunnel.ssh_profile.login_account = JsonString(sp, {"loginAccount", "user"});
      p.options.tunnel.ssh_profile.secret = JsonString(sp, {"secret", "password"});
      nlohmann::json sp_opts = nlohmann::json::object();
      if (sp.contains("options") && sp["options"].is_object()) {
        sp_opts = sp["options"];
      }
      p.options.tunnel.ssh_profile.timeout_seconds =
          JsonInt(sp_opts, {"timeout_seconds", "timeoutSeconds"}, 30);
      p.options.tunnel.ssh_profile.auth_type = JsonString(sp_opts, {"auth_type", "authType"});
      if (p.options.tunnel.ssh_profile.auth_type.empty()) {
        p.options.tunnel.ssh_profile.auth_type = "password";
      }
      p.options.tunnel.ssh_profile.private_key_path =
          JsonString(sp_opts, {"private_key_path", "privateKeyPath"});
      p.options.tunnel.ssh_profile.passphrase = JsonString(sp_opts, {"passphrase"});
      if (sp_opts.contains("proxy") && sp_opts["proxy"].is_object()) {
        const auto& jpx = sp_opts["proxy"];
        p.options.tunnel.ssh_profile.proxy.type = JsonString(jpx, {"type"});
        p.options.tunnel.ssh_profile.proxy.host = JsonString(jpx, {"host"});
        p.options.tunnel.ssh_profile.proxy.port = JsonInt(jpx, {"port"}, 0);
        p.options.tunnel.ssh_profile.proxy.username = JsonString(jpx, {"username", "user"});
        p.options.tunnel.ssh_profile.proxy.password = JsonString(jpx, {"password"});
      }
    }
  }
  p.options.ssl_mode = ToLower(JsonString(opts, {"ssl_mode", "sslMode"}));
  if (p.options.ssl_mode.empty()) {
    p.options.ssl_mode = "disable";
  }
  p.options.wallet_path = JsonString(opts, {"wallet_path", "walletPath"});
  p.options.wallet_password = JsonString(opts, {"wallet_password", "walletPassword"});
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
  const bool ssl = options.SslEnabled();
  const std::string wallet = NormalizeFsPath(options.wallet_path);
  const bool verify = options.SslVerify();

  if (!options.service_name.empty()) {
    // Easy Connect Plus：tcps://…?wallet_location=…（Oracle Client 19c+）
    std::ostringstream oss;
    if (ssl) {
      oss << "tcps://";
    }
    oss << host_address << ":" << port << "/" << options.service_name
        << "?connect_timeout=" << timeout;
    if (ssl && !wallet.empty()) {
      oss << "&wallet_location=" << QuoteEasyConnectValue(wallet);
    }
    if (ssl && verify) {
      oss << "&ssl_server_dn_match=yes";
    } else if (ssl && !verify) {
      oss << "&ssl_server_dn_match=no";
    }
    return oss.str();
  }

  if (!options.sid.empty()) {
    const char* protocol = ssl ? "TCPS" : "TCP";
    std::ostringstream oss;
    oss << "(DESCRIPTION=(CONNECT_TIMEOUT=" << timeout << ")(ADDRESS=(PROTOCOL=" << protocol
        << ")(HOST=" << host_address << ")(PORT=" << port << "))(CONNECT_DATA=(SID=" << options.sid
        << "))";
    if (ssl) {
      oss << "(SECURITY=";
      if (!wallet.empty()) {
        oss << "(WALLET_LOCATION=" << wallet << ")";
      }
      oss << "(SSL_SERVER_DN_MATCH=" << (verify ? "TRUE" : "FALSE") << ")";
      oss << ")";
    }
    oss << ")";
    return oss.str();
  }
  return {};
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
    error += "; install Oracle Instant Client, then set ORACLE_HOME, "
             "or configure it in Settings → Tool Components (Oracle Instant Client), "
             "or place oci.dll under services/bin/runtime/oracle";
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
  if (params.options.service_name.empty() && params.options.sid.empty()) {
    error = "oracle: service name or SID required";
    return out;
  }
  if (!params.options.service_name.empty() && !params.options.sid.empty()) {
    error = "oracle: set either service name or SID, not both";
    return out;
  }
  if (params.options.SslVerify() && params.options.wallet_path.empty()) {
    error = "oracle: wallet path required when SSL mode is verify-full";
    return out;
  }
  // 隧道与代理互斥：都配置时优先隧道（与 MySQL/Redis 一致）。
  ConnectParams dial = params;
  const uint16_t target_port =
      static_cast<uint16_t>(params.port_number > 0 ? params.port_number : 1521);
  if (params.options.tunnel.Enabled()) {
    std::string local_host;
    uint16_t local_port = 0;
    auto tunnel = niuma::sshtunnel::StartSSHTunnel(params.options.tunnel, params.host_address, target_port,
                                                   local_host, local_port, error);
    if (!tunnel) {
      if (error.empty()) {
        error = "oracle: ssh tunnel failed";
      } else if (error.rfind("oracle:", 0) != 0) {
        error = "oracle: " + error;
      }
      return out;
    }
    dial.host_address = local_host;
    dial.port_number = static_cast<int>(local_port);
    out.ssh_tunnel = std::move(tunnel);
  } else if (params.options.proxy.Enabled()) {
    std::string local_host;
    uint16_t local_port = 0;
    auto relay = niuma::netproxy::StartRelay(params.options.proxy, params.host_address, target_port, local_host,
                                             local_port, error);
    if (!relay) {
      if (error.empty()) {
        error = "oracle: proxy relay failed";
      } else {
        error = "oracle: " + error;
      }
      return out;
    }
    dial.host_address = local_host;
    dial.port_number = static_cast<int>(local_port);
    out.proxy_relay = std::move(relay);
  }

  auto clear_relays = [&out]() {
    out.conn.reset();
    out.proxy_relay.reset();
    out.ssh_tunnel.reset();
  };

  auto ctx = SharedContext(error);
  if (!ctx) {
    clear_relays();
    return out;
  }

  const std::string conn_str = dial.BuildConnectString();
  if (conn_str.empty()) {
    error = "oracle: service name or SID required";
    clear_relays();
    return out;
  }
  dpiConnCreateParams create{};
  dpiContext_initConnCreateParams(ctx.get(), &create);
  create.authMode = AuthMode(dial.options.role);

  dpiCommonCreateParams common{};
  dpiContext_initCommonCreateParams(ctx.get(), &common);
  // encoding
  common.encoding = "UTF-8";
  common.nencoding = "UTF-8";

  dpiConn* conn = nullptr;
  if (dpiConn_create(ctx.get(), dial.login_account.c_str(),
                     static_cast<uint32_t>(dial.login_account.size()), dial.secret.c_str(),
                     static_cast<uint32_t>(dial.secret.size()), conn_str.c_str(),
                     static_cast<uint32_t>(conn_str.size()), &common, &create, &conn) < 0) {
    error = DpiError(ctx.get());
    clear_relays();
    return out;
  }
  out.conn.reset(conn);

  if (!dial.options.app_name.empty()) {
    dpiConn_setClientInfo(conn, dial.options.app_name.c_str(),
                          static_cast<uint32_t>(dial.options.app_name.size()));
  }

  const std::string schema = dial.SchemaOrEmpty();
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
    clear_relays();
    return {};
  }
  return out;
}

}  // namespace niuma::oracle::session
