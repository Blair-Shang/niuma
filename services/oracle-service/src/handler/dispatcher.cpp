#include "handler/dispatcher.hpp"

#include "catalog/list.hpp"
#include "ddl/design.hpp"
#include "handler/log.hpp"
#include "meta/monitor.hpp"
#include "meta/relation.hpp"
#include "meta/routines.hpp"
#include "session/connect.hpp"
#include "session/explain.hpp"
#include "session/load_lob.hpp"
#include "session/query.hpp"
#include "session/resolve.hpp"
#include "session/tx.hpp"
#include "tree/list.hpp"
#include "util/idgen.hpp"
#include "util/dpi_error.hpp"
#include "util/utf8.hpp"

#include <memory>
#include <mutex>
#include <nlohmann/json.hpp>
#include <vector>

#include "util/connection_error.hpp"

namespace niuma::oracle::handler {
namespace {

constexpr auto kJsonReplace = nlohmann::json::error_handler_t::replace;

std::string Fail(const std::string& id, std::string err) {
  err = util::EnsureUtf8(std::move(err));
  nlohmann::json j{{"id", id}, {"ok", false}, {"error", err}, {"result", ""}};
  return j.dump(-1, ' ', false, kJsonReplace);
}

std::string Ok(const std::string& id, const nlohmann::json& result) {
  nlohmann::json j{{"id", id},
                   {"ok", true},
                   {"result", result.dump(-1, ' ', false, kJsonReplace)}};
  return j.dump(-1, ' ', false, kJsonReplace);
}

/** 连接断开时关闭 session，并在错误文案中提示重连。 */
void NoteSessionError(session::Manager& sessions, const std::string& sid, std::string& err) {
  err = util::EnsureUtf8(err);
  if (sid.empty() || !util::IsConnectionLost(err)) {
    return;
  }
  sessions.Close(sid);
  if (err.find("please reconnect") == std::string::npos) {
    err += " (session closed, please reconnect)";
  }
}

std::string SchemaOf(const nlohmann::json& j) {
  if (j.contains("schema") && j["schema"].is_string()) {
    return j["schema"].get<std::string>();
  }
  if (j.contains("database") && j["database"].is_string()) {
    return j["database"].get<std::string>();
  }
  return {};
}

dataio::CsvOptions CsvOptionsOf(const nlohmann::json& j) {
  dataio::CsvOptions opts;
  if (!j.is_object()) {
    return opts;
  }
  if (j.contains("header") && j["header"].is_boolean()) {
    opts.header = j["header"].get<bool>();
  }
  if (j.contains("delimiter") && j["delimiter"].is_string()) {
    opts.delimiter = j["delimiter"].get<std::string>();
  }
  if (j.contains("nullString") && j["nullString"].is_string()) {
    opts.null_string = j["nullString"].get<std::string>();
  } else if (j.contains("null_string") && j["null_string"].is_string()) {
    opts.null_string = j["null_string"].get<std::string>();
  }
  if (j.contains("truncate") && j["truncate"].is_boolean()) {
    opts.truncate = j["truncate"].get<bool>();
  }
  const nlohmann::json* column_map = nullptr;
  if (j.contains("columnMap") && j["columnMap"].is_object()) {
    column_map = &j["columnMap"];
  } else if (j.contains("column_map") && j["column_map"].is_object()) {
    column_map = &j["column_map"];
  }
  if (column_map != nullptr) {
    for (auto it = column_map->begin(); it != column_map->end(); ++it) {
      if (it.value().is_string()) {
        opts.column_map[it.key()] = it.value().get<std::string>();
      }
    }
  }
  return opts;
}

dataio::DumpParams DumpParamsOf(const nlohmann::json& j) {
  dataio::DumpParams dump;
  if (!j.is_object()) {
    return dump;
  }
  dump.schema = j.value("schema", "");
  if (dump.schema.empty()) {
    dump.schema = j.value("database", "");
  }
  dump.mode = j.value("mode", "structure_and_data");
  dump.output_path = j.value("outputPath", j.value("output_path", ""));
  dump.drop_if_exists = j.value("dropIfExists", j.value("drop_if_exists", false));
  dump.truncate_before_data = j.value("truncateBeforeData", j.value("truncate_before_data", false));
  dump.include_tables = j.value("includeTables", j.value("include_tables", false));
  dump.include_views = j.value("includeViews", j.value("include_views", false));
  dump.include_procedures = j.value("includeProcedures", j.value("include_procedures", false));
  dump.include_functions = j.value("includeFunctions", j.value("include_functions", false));
  dump.include_packages = j.value("includePackages", j.value("include_packages", false));
  dump.include_sequences = j.value("includeSequences", j.value("include_sequences", false));
  if (j.contains("tables") && j["tables"].is_array()) {
    for (const auto& t : j["tables"]) {
      if (t.is_string()) {
        dump.tables.push_back(t.get<std::string>());
      }
    }
  }
  // 未指定任何类型时默认全开（兼容旧客户端）。
  if (!dump.include_tables && !dump.include_views && !dump.include_procedures &&
      !dump.include_functions && !dump.include_packages && !dump.include_sequences) {
    dump.include_tables = true;
    dump.include_views = true;
    dump.include_procedures = true;
    dump.include_functions = true;
    dump.include_packages = true;
    dump.include_sequences = true;
  }
  return dump;
}

bool ResolveTaskConnect(session::Manager& sessions, const nlohmann::json& params,
                        session::ConnectParams& out, std::string& error) {
  const std::string sid = params.value("sessionId", "");
  if (!sid.empty()) {
    auto s = sessions.Get(sid);
    if (!s) {
      error = "oracle: session not found";
      return false;
    }
    out = s->params;
    return true;
  }
  out = session::ConnectParams::FromJson(params);
  if (out.host_address.empty()) {
    error = "oracle: sessionId or connection params required";
    return false;
  }
  return true;
}

std::string IoOwnerOf(const nlohmann::json& params) {
  const std::string sid = params.value("sessionId", "");
  if (!sid.empty()) return "session:" + sid;
  const std::string profile_id = params.value("profileId", "");
  if (!profile_id.empty()) return "profile:" + profile_id;
  return "inline:" + params.value("hostAddress", "") + ":" +
         std::to_string(params.value("portNumber", 0)) + ":" +
         params.value("loginAccount", "");
}

}  // namespace

Dispatcher::Dispatcher() = default;

std::string Dispatcher::HandleFrame(const std::string& raw_json) {
  nlohmann::json req;
  try {
    req = nlohmann::json::parse(raw_json);
  } catch (const std::exception& e) {
    return Fail("", std::string("invalid request json: ") + e.what());
  }

  const std::string id = req.value("id", "");
  const std::string method = req.value("method", "");
  nlohmann::json params = nlohmann::json::object();
  if (req.contains("params") && !req["params"].is_null()) {
    if (req["params"].is_string()) {
      try {
        params = nlohmann::json::parse(req["params"].get<std::string>());
      } catch (...) {
        return Fail(id, "invalid params");
      }
    } else if (req["params"].is_object()) {
      params = req["params"];
    }
  }

  try {
    if (method == "session.open") {
      auto cp = session::ConnectParams::FromJson(params);
      std::string err;
      auto opened = session::ConnectAndProbe(cp, err);
      if (!opened.conn) {
        LogOpError(method, err.empty() ? "oracle: connect failed" : err,
                   {{"host", cp.host_address}, {"port", cp.port_number}});
        return Fail(id, err.empty() ? "oracle: connect failed" : err);
      }
      auto s = std::make_shared<session::Session>();
      s->id = util::NextId("sess");
      s->conn = std::move(opened.conn);
      s->ctx = session::SharedContext(err);
      s->params = std::move(cp);
      s->profile = std::move(opened.profile);
      s->proxy_relay = std::move(opened.proxy_relay);
      sessions_.Put(s);
      LogOpInfo(method, {{"session", s->id},
                         {"host", s->params.host_address},
                         {"port", s->params.port_number},
                         {"family", s->profile.family}});
      return Ok(id, {{"sessionId", s->id}, {"dialect", s->profile.ToJson()}});
    }

    if (method == "session.close") {
      const std::string sid = params.value("sessionId", "");
      if (sid.empty()) {
        return Fail(id, "sessionId required");
      }
      (void)io_.CancelByOwner("session:" + sid);
      if (!sessions_.Close(sid)) {
        LogOpError(method, "oracle: session not found", {{"session", sid}});
        return Fail(id, "oracle: session not found: " + sid);
      }
      LogOpInfo(method, {{"session", sid}});
      return Ok(id, {{"closed", true}});
    }

    if (method == "session.test") {
      auto cp = session::ConnectParams::FromJson(params);
      std::string err;
      auto opened = session::ConnectAndProbe(cp, err);
      if (!opened.conn) {
        LogOpError(method, err.empty() ? "connect failed" : err,
                   {{"host", cp.host_address}, {"port", cp.port_number}, {"ok", false}});
        return Ok(id, {{"ok", false}, {"message", err.empty() ? "connect failed" : err}});
      }
      opened.conn.reset();
      LogOpInfo(method, {{"host", cp.host_address}, {"port", cp.port_number}, {"ok", true}});
      return Ok(id, {{"ok", true},
                     {"message", "connected"},
                     {"version", opened.profile.version},
                     {"dialect", opened.profile.ToJson()}});
    }

    if (method == "query.exec") {
      auto qp = session::QueryExecParams::FromJson(params);
      auto s = sessions_.Get(qp.session_id);
      if (!s) {
        return Fail(id, "oracle: session not found");
      }
      std::lock_guard exec_lock(s->exec_mu);
      std::string err;
      auto result = session::ExecQuery(*s, qp, err);
      if (!err.empty()) {
        NoteSessionError(sessions_, qp.session_id, err);
        if (err.find("cancel") != std::string::npos) {
          LogOpInfo(method, {{"session", qp.session_id}, {"schema", qp.schema}, {"canceled", true}});
        } else {
          LogOpWarn(method, err, {{"session", qp.session_id}, {"schema", qp.schema}});
        }
        return Fail(id, err);
      }
      LogOpInfo(method, {{"session", qp.session_id},
                         {"schema", qp.schema},
                         {"rows", result.value("rowCount", 0)},
                         {"hasMore", result.value("hasMore", false)},
                         {"resultSet", result.value("resultSetId", "")}});
      return Ok(id, result);
    }

    if (method == "query.fetch") {
      const std::string sid = params.value("sessionId", "");
      const std::string rsid = params.value("resultSetId", "");
      int limit = params.value("limit", 1000);
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found");
      }
      std::lock_guard exec_lock(s->exec_mu);
      std::string err;
      auto result = session::FetchMore(*s, rsid, limit, err);
      if (!err.empty()) {
        NoteSessionError(sessions_, sid, err);
        LogOpWarn(method, err, {{"session", sid}, {"resultSet", rsid}});
        return Fail(id, err);
      }
      LogOpInfo(method, {{"session", sid},
                         {"resultSet", rsid},
                         {"rows", result.value("rowCount", 0)},
                         {"hasMore", result.value("hasMore", false)}});
      return Ok(id, result);
    }

    if (method == "query.close") {
      const std::string sid = params.value("sessionId", "");
      const std::string rsid = params.value("resultSetId", "");
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found");
      }
      std::lock_guard exec_lock(s->exec_mu);
      session::CloseResultSet(*s, rsid);
      LogOpInfo(method, {{"session", sid}, {"resultSet", rsid}});
      return Ok(id, {{"closed", true}});
    }

    if (method == "query.cancel") {
      const std::string sid = params.value("sessionId", "");
      const std::string rid = params.value("requestId", "");
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found");
      }
      session::CancelQuery(*s, rid);
      LogOpInfo(method, {{"session", sid}, {"requestId", rid}});
      return Ok(id, {{"cancelled", true}});
    }

    if (method == "query.explain") {
      auto qp = session::QueryExecParams::FromJson(params);
      auto s = sessions_.Get(qp.session_id);
      if (!s) {
        return Fail(id, "oracle: session not found");
      }
      std::lock_guard exec_lock(s->exec_mu);
      std::string err;
      auto result = session::ExplainQuery(*s, qp, err);
      if (!err.empty()) {
        NoteSessionError(sessions_, qp.session_id, err);
        LogOpWarn(method, err, {{"session", qp.session_id}});
        return Fail(id, err);
      }
      LogOpInfo(method, {{"session", qp.session_id}, {"rows", result.value("rowCount", 0)}});
      return Ok(id, result);
    }

    if (method == "query.loadLob") {
      auto lp = session::LoadLobParams::FromJson(params);
      auto s = sessions_.Get(lp.session_id);
      if (!s) {
        return Fail(id, "oracle: session not found");
      }
      std::lock_guard exec_lock(s->exec_mu);
      std::string err;
      auto result = session::LoadLob(*s, lp, err);
      if (!err.empty()) {
        NoteSessionError(sessions_, lp.session_id, err);
        return Fail(id, err);
      }
      return Ok(id, result);
    }

    if (method == "tx.getState") {
      const std::string sid = params.value("sessionId", "");
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found");
      }
      return Ok(id, session::TxStateJson(*s));
    }

    if (method == "tx.setAutoCommit") {
      const std::string sid = params.value("sessionId", "");
      const bool enabled = params.value("autoCommit", true);
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found");
      }
      std::lock_guard exec_lock(s->exec_mu);
      std::string err;
      auto result = session::SetAutoCommit(*s, enabled, err);
      if (!err.empty()) {
        NoteSessionError(sessions_, sid, err);
        return Fail(id, err);
      }
      return Ok(id, result);
    }

    if (method == "tx.commit" || method == "tx.rollback") {
      const std::string sid = params.value("sessionId", "");
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found");
      }
      std::lock_guard exec_lock(s->exec_mu);
      std::string err;
      auto result = method == "tx.commit" ? session::Commit(*s, err) : session::Rollback(*s, err);
      if (!err.empty()) {
        NoteSessionError(sessions_, sid, err);
        return Fail(id, err);
      }
      return Ok(id, result);
    }

    if (method == "tree.schemas" || method == "tree.tables" || method == "tree.routines" ||
        method == "tree.sequences" || method == "tree.packages" || method == "tree.categoryCounts" ||
        method == "catalog.schemas" || method == "catalog.tables" || method == "catalog.columns" ||
        method == "meta.columns" || method == "meta.indexes" || method == "meta.ddl" ||
        method == "meta.primaryKey" || method == "meta.foreignKeys" || method == "meta.routineSource" ||
        method == "meta.packageSource" || method == "meta.processlist" || method == "meta.kill" ||
        method == "meta.instanceOverview" || method == "meta.locks") {
      auto resolved = session::ResolveSession(sessions_, params);
      if (!resolved.ok) {
        return Fail(id, resolved.error);
      }
      auto release = std::move(resolved.release);
      auto& s = *resolved.session;
      std::lock_guard exec_lock(s.exec_mu);
      std::string err;
      nlohmann::json result;

      if (method.rfind("tree.", 0) == 0) {
        auto lp = tree::ListParams::FromJson(params);
        if (!params.contains("excludeSystem") && !params.contains("exclude_system")) {
          lp.exclude_system = s.params.options.exclude_system_schemas;
        }
        if (method == "tree.schemas") {
          result = tree::ListSchemas(s, lp, err);
        } else if (method == "tree.tables") {
          result = tree::ListTables(s, lp, err);
        } else if (method == "tree.routines") {
          result = tree::ListRoutines(s, lp, err);
        } else if (method == "tree.sequences") {
          result = tree::ListSequences(s, lp, err);
        } else if (method == "tree.packages") {
          result = tree::ListPackages(s, lp, err);
        } else {
          result = tree::CategoryCounts(s, lp, err);
        }
      } else if (method.rfind("catalog.", 0) == 0) {
        auto lp = catalog::ListParams::FromJson(params);
        if (method == "catalog.schemas") {
          result = catalog::ListSchemas(s, lp, err);
        } else if (method == "catalog.tables") {
          result = catalog::ListTables(s, lp, err);
        } else {
          result = catalog::ListColumns(s, lp, err);
        }
      } else if (method == "meta.routineSource") {
        result = meta::GetRoutineSource(s, meta::RoutineRef::FromJson(params), err);
      } else if (method == "meta.packageSource") {
        result = meta::GetPackageSource(s, meta::PackageRef::FromJson(params), err);
      } else if (method == "meta.processlist") {
        result = meta::ListProcesslist(s, err);
      } else if (method == "meta.kill") {
        const int64_t kid = params.value("id", static_cast<int64_t>(0));
        const int64_t serial = params.value("serial", static_cast<int64_t>(0));
        const bool query_only = params.value("queryOnly", false);
        result = meta::KillSession(s, kid, serial, query_only, err);
      } else if (method == "meta.instanceOverview") {
        result = meta::InstanceOverview(s, err);
      } else if (method == "meta.locks") {
        result = meta::ListLocks(s, params.value("limit", 200), err);
      } else {
        auto ref = meta::RelationRef::FromJson(params);
        if (method == "meta.columns") {
          result = meta::ListColumns(s, ref, err);
        } else if (method == "meta.indexes") {
          result = meta::ListIndexes(s, ref, err);
        } else if (method == "meta.ddl") {
          result = meta::GetDDL(s, ref, err);
        } else if (method == "meta.foreignKeys") {
          result = meta::ListForeignKeys(s, ref, err);
        } else {
          result = meta::GetPrimaryKey(s, ref, err);
        }
      }

      const std::string sid = params.value("sessionId", "");
      const std::string schema = SchemaOf(params);
      release();
      if (!err.empty()) {
        NoteSessionError(sessions_, sid, err);
        LogOpWarn(method, err, {{"session", sid}, {"schema", schema}});
        return Fail(id, err);
      }
      LogOpInfo(method, {{"session", sid}, {"schema", schema}});
      return Ok(id, result);
    }

    if (method == "ddl.designPreview") {
      std::string err;
      auto result = ddl::DesignPreview(params, err);
      const std::string schema = SchemaOf(params);
      const std::string table = params.value("name", params.value("table", ""));
      if (!err.empty()) {
        LogOpWarn(method, err, {{"schema", schema}, {"table", table}});
        return Fail(id, err);
      }
      LogOpInfo(method, {{"schema", schema},
                         {"table", table},
                         {"statements", result.contains("sql") && result["sql"].is_array()
                                            ? static_cast<int>(result["sql"].size())
                                            : 0}});
      return Ok(id, result);
    }

    if (method == "ddl.createTablePreview") {
      std::string err;
      auto result = ddl::CreateTablePreview(params, err);
      const std::string schema = SchemaOf(params);
      const std::string table = params.value("name", params.value("table", ""));
      if (!err.empty()) {
        LogOpWarn(method, err, {{"schema", schema}, {"table", table}});
        return Fail(id, err);
      }
      LogOpInfo(method, {{"schema", schema}, {"table", table}});
      return Ok(id, result);
    }

    if (method == "ddl.designApply" || method == "ddl.createTable") {
      auto resolved = session::ResolveSession(sessions_, params);
      if (!resolved.ok) {
        return Fail(id, resolved.error);
      }
      auto release = std::move(resolved.release);
      std::lock_guard exec_lock(resolved.session->exec_mu);
      std::string err;
      auto result = method == "ddl.designApply" ? ddl::DesignApply(*resolved.session, params, err)
                                               : ddl::CreateTable(*resolved.session, params, err);
      const std::string sid = params.value("sessionId", "");
      const std::string schema = SchemaOf(params);
      const std::string table = params.value("name", params.value("table", ""));
      release();
      if (!err.empty()) {
        NoteSessionError(sessions_, sid, err);
        LogOpWarn(method, err, {{"session", sid}, {"schema", schema}, {"table", table}});
        return Fail(id, err);
      }
      LogOpInfo(method, {{"session", sid}, {"schema", schema}, {"table", table}});
      return Ok(id, result);
    }

    if (method == "io.exportCsv") {
      session::ConnectParams connect;
      std::string err;
      if (!ResolveTaskConnect(sessions_, params, connect, err)) {
        return Fail(id, err);
      }
      const std::string schema = SchemaOf(params);
      const std::string table = params.value("table", "");
      const std::string output_path = params.value("outputPath", "");
      const std::string sid = params.value("sessionId", "");
      auto opts = CsvOptionsOf(params.value("csvOptions", nlohmann::json::object()));
      auto task_id =
          io_.ExportCsv(connect, schema, table, output_path, opts, IoOwnerOf(params), err);
      if (!err.empty() || task_id.empty()) {
        LogOpWarn(method, err.empty() ? "oracle: exportCsv failed" : err,
                  {{"session", sid}, {"schema", schema}, {"table", table}});
        return Fail(id, err.empty() ? "oracle: exportCsv failed" : err);
      }
      LogOpInfo(method, {{"session", sid}, {"schema", schema}, {"table", table}, {"task", task_id}});
      return Ok(id, {{"taskId", task_id}});
    }

    if (method == "io.importCsv") {
      session::ConnectParams connect;
      std::string err;
      if (!ResolveTaskConnect(sessions_, params, connect, err)) {
        return Fail(id, err);
      }
      const std::string schema = SchemaOf(params);
      const std::string table = params.value("table", "");
      const std::string input_path = params.value("inputPath", "");
      const std::string sid = params.value("sessionId", "");
      auto opts = CsvOptionsOf(params.value("csvOptions", nlohmann::json::object()));
      auto task_id =
          io_.ImportCsv(connect, schema, table, input_path, opts, IoOwnerOf(params), err);
      if (!err.empty() || task_id.empty()) {
        LogOpWarn(method, err.empty() ? "oracle: importCsv failed" : err,
                  {{"session", sid}, {"schema", schema}, {"table", table}});
        return Fail(id, err.empty() ? "oracle: importCsv failed" : err);
      }
      LogOpInfo(method, {{"session", sid}, {"schema", schema}, {"table", table}, {"task", task_id}});
      return Ok(id, {{"taskId", task_id}});
    }

    if (method == "io.dumpSql") {
      session::ConnectParams connect;
      std::string err;
      if (!ResolveTaskConnect(sessions_, params, connect, err)) {
        return Fail(id, err);
      }
      auto dump = DumpParamsOf(params.contains("dump") ? params["dump"] : params);
      const std::string sid = params.value("sessionId", "");
      auto task_id = io_.DumpSql(connect, dump, IoOwnerOf(params), err);
      if (!err.empty() || task_id.empty()) {
        LogOpWarn(method, err.empty() ? "oracle: dumpSql failed" : err,
                  {{"session", sid}, {"schema", dump.schema}});
        return Fail(id, err.empty() ? "oracle: dumpSql failed" : err);
      }
      LogOpInfo(method, {{"session", sid}, {"schema", dump.schema}, {"task", task_id}});
      return Ok(id, {{"taskId", task_id}});
    }

    if (method == "io.execSqlFile") {
      session::ConnectParams connect;
      std::string err;
      if (!ResolveTaskConnect(sessions_, params, connect, err)) {
        return Fail(id, err);
      }
      const std::string schema = SchemaOf(params);
      const std::string input_path = params.value("inputPath", "");
      const std::string sid = params.value("sessionId", "");
      bool continue_on_error = false;
      if (params.contains("execOptions") && params["execOptions"].is_object()) {
        continue_on_error = params["execOptions"].value("continueOnError", false);
      }
      auto task_id =
          io_.ExecSqlFile(connect, schema, input_path, continue_on_error, IoOwnerOf(params), err);
      if (!err.empty() || task_id.empty()) {
        LogOpWarn(method, err.empty() ? "oracle: execSqlFile failed" : err,
                  {{"session", sid}, {"schema", schema}});
        return Fail(id, err.empty() ? "oracle: execSqlFile failed" : err);
      }
      LogOpInfo(method, {{"session", sid}, {"schema", schema}, {"task", task_id}});
      return Ok(id, {{"taskId", task_id}});
    }

    if (method == "io.cancel") {
      const std::string task_id = params.value("taskId", "");
      if (task_id.empty()) {
        return Fail(id, "taskId required");
      }
      const std::string sid = params.value("sessionId", "");
      const bool canceled = io_.Cancel(task_id, IoOwnerOf(params));
      LogOpInfo(method, {{"session", sid}, {"task", task_id}, {"canceled", canceled}});
      return Ok(id, {{"canceled", canceled}, {"cancelled", canceled}, {"taskId", task_id}});
    }

    return Fail(id, "method not found: " + method);
  } catch (const std::exception& e) {
    LogOpError(method, e.what());
    return Fail(id, e.what());
  }
}

}  // namespace niuma::oracle::handler
