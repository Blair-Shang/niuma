#include "handler/dispatcher.hpp"

#include "catalog/list.hpp"
#include "ddl/design.hpp"
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

#include <memory>
#include <nlohmann/json.hpp>
#include <vector>

namespace niuma::oracle::handler {
namespace {

nlohmann::json Fail(const std::string& id, const std::string& err) {
  return nlohmann::json{{"id", id}, {"ok", false}, {"error", err}, {"result", ""}};
}

nlohmann::json Ok(const std::string& id, const nlohmann::json& result) {
  return nlohmann::json{{"id", id}, {"ok", true}, {"result", result.dump()}};
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
  dump.include_sequences = j.value("includeSequences", j.value("include_sequences", false));
  if (j.contains("tables") && j["tables"].is_array()) {
    for (const auto& t : j["tables"]) {
      if (t.is_string()) {
        dump.tables.push_back(t.get<std::string>());
      }
    }
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

}  // namespace

Dispatcher::Dispatcher() = default;

std::string Dispatcher::HandleFrame(const std::string& raw_json) {
  nlohmann::json req;
  try {
    req = nlohmann::json::parse(raw_json);
  } catch (const std::exception& e) {
    return Fail("", std::string("invalid request json: ") + e.what()).dump();
  }

  const std::string id = req.value("id", "");
  const std::string method = req.value("method", "");
  nlohmann::json params = nlohmann::json::object();
  if (req.contains("params") && !req["params"].is_null()) {
    if (req["params"].is_string()) {
      try {
        params = nlohmann::json::parse(req["params"].get<std::string>());
      } catch (...) {
        return Fail(id, "invalid params").dump();
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
        return Fail(id, err.empty() ? "oracle: connect failed" : err).dump();
      }
      auto s = std::make_shared<session::Session>();
      s->id = util::NextId("sess");
      s->conn = std::move(opened.conn);
      s->ctx = session::SharedContext(err);
      s->params = std::move(cp);
      s->profile = std::move(opened.profile);
      s->proxy_relay = std::move(opened.proxy_relay);
      sessions_.Put(s);
      return Ok(id, {{"sessionId", s->id}, {"dialect", s->profile.ToJson()}}).dump();
    }

    if (method == "session.close") {
      const std::string sid = params.value("sessionId", "");
      if (sid.empty()) {
        return Fail(id, "sessionId required").dump();
      }
      if (!sessions_.Close(sid)) {
        return Fail(id, "oracle: session not found: " + sid).dump();
      }
      return Ok(id, {{"closed", true}}).dump();
    }

    if (method == "session.test") {
      auto cp = session::ConnectParams::FromJson(params);
      std::string err;
      auto opened = session::ConnectAndProbe(cp, err);
      if (!opened.conn) {
        return Ok(id, {{"ok", false}, {"message", err.empty() ? "connect failed" : err}}).dump();
      }
      opened.conn.reset();
      return Ok(id, {{"ok", true},
                     {"message", "connected"},
                     {"version", opened.profile.version},
                     {"dialect", opened.profile.ToJson()}})
          .dump();
    }

    if (method == "query.exec") {
      auto qp = session::QueryExecParams::FromJson(params);
      auto s = sessions_.Get(qp.session_id);
      if (!s) {
        return Fail(id, "oracle: session not found").dump();
      }
      std::string err;
      auto result = session::ExecQuery(*s, qp, err);
      if (!err.empty()) {
        return Fail(id, err).dump();
      }
      return Ok(id, result).dump();
    }

    if (method == "query.fetch") {
      const std::string sid = params.value("sessionId", "");
      const std::string rsid = params.value("resultSetId", "");
      int limit = params.value("limit", 1000);
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found").dump();
      }
      std::string err;
      auto result = session::FetchMore(*s, rsid, limit, err);
      if (!err.empty()) {
        return Fail(id, err).dump();
      }
      return Ok(id, result).dump();
    }

    if (method == "query.close") {
      const std::string sid = params.value("sessionId", "");
      const std::string rsid = params.value("resultSetId", "");
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found").dump();
      }
      session::CloseResultSet(*s, rsid);
      return Ok(id, {{"closed", true}}).dump();
    }

    if (method == "query.cancel") {
      const std::string sid = params.value("sessionId", "");
      const std::string rid = params.value("requestId", "");
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found").dump();
      }
      session::CancelQuery(*s, rid);
      return Ok(id, {{"cancelled", true}}).dump();
    }

    if (method == "query.explain") {
      auto qp = session::QueryExecParams::FromJson(params);
      auto s = sessions_.Get(qp.session_id);
      if (!s) {
        return Fail(id, "oracle: session not found").dump();
      }
      std::string err;
      auto result = session::ExplainQuery(*s, qp, err);
      if (!err.empty()) {
        return Fail(id, err).dump();
      }
      return Ok(id, result).dump();
    }

    if (method == "query.loadLob") {
      auto lp = session::LoadLobParams::FromJson(params);
      auto s = sessions_.Get(lp.session_id);
      if (!s) {
        return Fail(id, "oracle: session not found").dump();
      }
      std::string err;
      auto result = session::LoadLob(*s, lp, err);
      if (!err.empty()) {
        return Fail(id, err).dump();
      }
      return Ok(id, result).dump();
    }

    if (method == "tx.getState") {
      const std::string sid = params.value("sessionId", "");
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found").dump();
      }
      return Ok(id, session::TxStateJson(*s)).dump();
    }

    if (method == "tx.setAutoCommit") {
      const std::string sid = params.value("sessionId", "");
      const bool enabled = params.value("autoCommit", true);
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found").dump();
      }
      std::string err;
      auto result = session::SetAutoCommit(*s, enabled, err);
      if (!err.empty()) {
        return Fail(id, err).dump();
      }
      return Ok(id, result).dump();
    }

    if (method == "tx.commit" || method == "tx.rollback") {
      const std::string sid = params.value("sessionId", "");
      auto s = sessions_.Get(sid);
      if (!s) {
        return Fail(id, "oracle: session not found").dump();
      }
      std::string err;
      auto result = method == "tx.commit" ? session::Commit(*s, err) : session::Rollback(*s, err);
      if (!err.empty()) {
        return Fail(id, err).dump();
      }
      return Ok(id, result).dump();
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
        return Fail(id, resolved.error).dump();
      }
      auto release = std::move(resolved.release);
      auto& s = *resolved.session;
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

      release();
      if (!err.empty()) {
        return Fail(id, err).dump();
      }
      return Ok(id, result).dump();
    }

    if (method == "ddl.designPreview") {
      std::string err;
      auto result = ddl::DesignPreview(params, err);
      if (!err.empty()) {
        return Fail(id, err).dump();
      }
      return Ok(id, result).dump();
    }

    if (method == "ddl.createTablePreview") {
      std::string err;
      auto result = ddl::CreateTablePreview(params, err);
      if (!err.empty()) {
        return Fail(id, err).dump();
      }
      return Ok(id, result).dump();
    }

    if (method == "ddl.designApply" || method == "ddl.createTable") {
      auto resolved = session::ResolveSession(sessions_, params);
      if (!resolved.ok) {
        return Fail(id, resolved.error).dump();
      }
      auto release = std::move(resolved.release);
      std::string err;
      auto result = method == "ddl.designApply" ? ddl::DesignApply(*resolved.session, params, err)
                                               : ddl::CreateTable(*resolved.session, params, err);
      release();
      if (!err.empty()) {
        return Fail(id, err).dump();
      }
      return Ok(id, result).dump();
    }

    if (method == "io.exportCsv") {
      session::ConnectParams connect;
      std::string err;
      if (!ResolveTaskConnect(sessions_, params, connect, err)) {
        return Fail(id, err).dump();
      }
      const std::string schema = SchemaOf(params);
      const std::string table = params.value("table", "");
      const std::string output_path = params.value("outputPath", "");
      auto opts = CsvOptionsOf(params.value("csvOptions", nlohmann::json::object()));
      auto task_id = io_.ExportCsv(connect, schema, table, output_path, opts, err);
      if (!err.empty() || task_id.empty()) {
        return Fail(id, err.empty() ? "oracle: exportCsv failed" : err).dump();
      }
      return Ok(id, {{"taskId", task_id}}).dump();
    }

    if (method == "io.importCsv") {
      session::ConnectParams connect;
      std::string err;
      if (!ResolveTaskConnect(sessions_, params, connect, err)) {
        return Fail(id, err).dump();
      }
      const std::string schema = SchemaOf(params);
      const std::string table = params.value("table", "");
      const std::string input_path = params.value("inputPath", "");
      auto opts = CsvOptionsOf(params.value("csvOptions", nlohmann::json::object()));
      auto task_id = io_.ImportCsv(connect, schema, table, input_path, opts, err);
      if (!err.empty() || task_id.empty()) {
        return Fail(id, err.empty() ? "oracle: importCsv failed" : err).dump();
      }
      return Ok(id, {{"taskId", task_id}}).dump();
    }

    if (method == "io.dumpSql") {
      session::ConnectParams connect;
      std::string err;
      if (!ResolveTaskConnect(sessions_, params, connect, err)) {
        return Fail(id, err).dump();
      }
      auto dump = DumpParamsOf(params.contains("dump") ? params["dump"] : params);
      auto task_id = io_.DumpSql(connect, dump, err);
      if (!err.empty() || task_id.empty()) {
        return Fail(id, err.empty() ? "oracle: dumpSql failed" : err).dump();
      }
      return Ok(id, {{"taskId", task_id}}).dump();
    }

    if (method == "io.execSqlFile") {
      session::ConnectParams connect;
      std::string err;
      if (!ResolveTaskConnect(sessions_, params, connect, err)) {
        return Fail(id, err).dump();
      }
      const std::string schema = SchemaOf(params);
      const std::string input_path = params.value("inputPath", "");
      bool continue_on_error = false;
      if (params.contains("execOptions") && params["execOptions"].is_object()) {
        continue_on_error = params["execOptions"].value("continueOnError", false);
      }
      auto task_id = io_.ExecSqlFile(connect, schema, input_path, continue_on_error, err);
      if (!err.empty() || task_id.empty()) {
        return Fail(id, err.empty() ? "oracle: execSqlFile failed" : err).dump();
      }
      return Ok(id, {{"taskId", task_id}}).dump();
    }

    if (method == "io.cancel") {
      const std::string task_id = params.value("taskId", "");
      if (task_id.empty()) {
        return Fail(id, "taskId required").dump();
      }
      const bool canceled = io_.Cancel(task_id);
      return Ok(id, {{"canceled", canceled}, {"cancelled", canceled}, {"taskId", task_id}}).dump();
    }

    return Fail(id, "method not found: " + method).dump();
  } catch (const std::exception& e) {
    return Fail(id, e.what()).dump();
  }
}

}  // namespace niuma::oracle::handler
