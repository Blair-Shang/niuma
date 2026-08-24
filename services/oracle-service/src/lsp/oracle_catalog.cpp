#include "lsp/oracle_catalog.hpp"

#include "catalog/list.hpp"
#include "session/sql_rows.hpp"
#include "tree/list.hpp"
#include "util/ident.hpp"
#include "util/sql_literal.hpp"

#include <mutex>

namespace niuma::oracle::lsp {
namespace {

bool ResolveSession(session::Manager& sessions, const std::string& session_id,
                    std::shared_ptr<session::Session>& out, std::string& error) {
  if (session_id.empty()) {
    error = "oracle: sessionId required";
    return false;
  }
  out = sessions.Get(session_id);
  if (!out) {
    error = "oracle: session not found";
    return false;
  }
  return true;
}

std::string SchemaOf(const niuma::sqllsp::CatalogParams& params) {
  if (!params.schema.empty()) return params.schema;
  return params.database;
}

/** 表列为空时探测是否为序列，注入 NEXTVAL / CURRVAL。 */
bool TrySequencePseudoColumns(session::Session& session, const std::string& schema,
                              const std::string& name, const std::string& prefix,
                              std::vector<niuma::sqllsp::ColumnHit>& out, std::string& error) {
  if (!util::IsSafeIdent(schema) || !util::IsSafeIdent(name)) return false;
  const std::string owner = util::QuoteLiteral(schema);
  const std::string seq = util::QuoteLiteral(name);
  const std::string sql =
      "SELECT SEQUENCE_NAME FROM ALL_SEQUENCES WHERE UPPER(SEQUENCE_OWNER) = UPPER(" + owner +
      ") AND UPPER(SEQUENCE_NAME) = UPPER(" + seq + ")";
  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, 2, rows, error)) {
    // 探测失败不阻断补全
    error.clear();
    return false;
  }
  if (rows.rows.empty()) return false;

  auto maybe_add = [&](const char* col, const char* dtype) {
    const std::string label = col;
    if (!prefix.empty()) {
      const std::string pl = prefix;
      std::string ll = label;
      for (char& c : ll) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
      }
      std::string pp = pl;
      for (char& c : pp) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
      }
      if (ll.rfind(pp, 0) != 0) return;
    }
    niuma::sqllsp::ColumnHit hit;
    hit.name = label;
    hit.data_type = dtype;
    hit.schema = schema;
    hit.table = name;
    out.push_back(std::move(hit));
  };
  maybe_add("NEXTVAL", "sequence");
  maybe_add("CURRVAL", "sequence");
  return !out.empty() || prefix.empty();
}

}  // namespace

bool OracleCatalog::ListSchemas(const niuma::sqllsp::CatalogParams& params,
                                std::vector<niuma::sqllsp::SchemaHit>& out, bool& truncated,
                                std::string& error) {
  out.clear();
  truncated = false;
  std::shared_ptr<session::Session> s;
  if (!ResolveSession(sessions_, params.session_id, s, error)) return false;
  std::lock_guard lock(s->exec_mu);

  catalog::ListParams lp;
  lp.prefix = params.prefix;
  lp.limit = params.limit > 0 ? params.limit : 100;
  auto result = catalog::ListSchemas(*s, lp, error);
  if (!error.empty()) return false;
  truncated = result.value("truncated", false);
  for (const auto& item : result.value("schemas", nlohmann::json::array())) {
    if (!item.is_object()) continue;
    niuma::sqllsp::SchemaHit hit;
    hit.name = item.value("name", "");
    if (!hit.name.empty()) out.push_back(std::move(hit));
  }
  return true;
}

bool OracleCatalog::ListTables(const niuma::sqllsp::CatalogParams& params,
                               std::vector<niuma::sqllsp::TableHit>& out, bool& truncated,
                               std::string& error) {
  out.clear();
  truncated = false;
  std::shared_ptr<session::Session> s;
  if (!ResolveSession(sessions_, params.session_id, s, error)) return false;
  std::lock_guard lock(s->exec_mu);

  catalog::ListParams lp;
  lp.schema = SchemaOf(params);
  lp.prefix = params.prefix;
  lp.limit = params.limit > 0 ? params.limit : 100;
  auto result = catalog::ListTables(*s, lp, error);
  if (!error.empty()) return false;
  truncated = result.value("truncated", false);
  for (const auto& item : result.value("tables", nlohmann::json::array())) {
    if (!item.is_object()) continue;
    niuma::sqllsp::TableHit hit;
    hit.name = item.value("name", "");
    hit.type = item.value("type", "table");
    hit.schema = item.value("schema", lp.schema);
    if (!hit.name.empty()) out.push_back(std::move(hit));
  }

  // 附带序列名（SELECT seq.NEXTVAL / 发现对象）；limit 共用，超限标 truncated
  tree::ListParams tp;
  tp.schema = lp.schema;
  tp.filter = params.prefix;
  const int remain = lp.limit > static_cast<int>(out.size()) ? lp.limit - static_cast<int>(out.size()) : 0;
  if (remain > 0) {
    tp.limit = remain;
    std::string seq_err;
    auto seqs = tree::ListSequences(*s, tp, seq_err);
    if (seq_err.empty()) {
      if (seqs.value("truncated", false)) truncated = true;
      for (const auto& item : seqs.value("sequences", nlohmann::json::array())) {
        if (!item.is_object()) continue;
        niuma::sqllsp::TableHit hit;
        hit.name = item.value("name", "");
        hit.type = "sequence";
        hit.schema = item.value("schema", lp.schema);
        if (!hit.name.empty()) out.push_back(std::move(hit));
      }
    }
  } else {
    truncated = true;
  }
  return true;
}

bool OracleCatalog::ListColumns(const niuma::sqllsp::CatalogParams& params,
                                std::vector<niuma::sqllsp::ColumnHit>& out, bool& truncated,
                                std::string& error) {
  out.clear();
  truncated = false;
  std::shared_ptr<session::Session> s;
  if (!ResolveSession(sessions_, params.session_id, s, error)) return false;
  std::lock_guard lock(s->exec_mu);

  catalog::ListParams lp;
  lp.schema = SchemaOf(params);
  lp.table = params.table;
  lp.prefix = params.prefix;
  lp.limit = params.limit > 0 ? params.limit : 100;
  auto result = catalog::ListColumns(*s, lp, error);
  if (!error.empty()) return false;
  truncated = result.value("truncated", false);
  for (const auto& item : result.value("columns", nlohmann::json::array())) {
    if (!item.is_object()) continue;
    niuma::sqllsp::ColumnHit hit;
    hit.name = item.value("name", "");
    hit.data_type = item.value("dataType", item.value("type", ""));
    hit.schema = lp.schema;
    hit.table = lp.table;
    if (!hit.name.empty()) out.push_back(std::move(hit));
  }
  if (out.empty()) {
    std::string probe_err;
    TrySequencePseudoColumns(*s, lp.schema, lp.table, params.prefix, out, probe_err);
  }
  return true;
}

bool OracleCatalog::ListRoutines(const niuma::sqllsp::CatalogParams& params,
                                 std::vector<niuma::sqllsp::RoutineHit>& out, bool& truncated,
                                 std::string& error) {
  out.clear();
  truncated = false;
  std::shared_ptr<session::Session> s;
  if (!ResolveSession(sessions_, params.session_id, s, error)) return false;
  std::lock_guard lock(s->exec_mu);

  tree::ListParams lp;
  lp.schema = SchemaOf(params);
  lp.filter = params.prefix;
  lp.limit = params.limit > 0 ? params.limit : 100;
  auto result = tree::ListRoutines(*s, lp, error);
  if (!error.empty()) return false;
  truncated = result.value("truncated", false);
  for (const auto& item : result.value("routines", nlohmann::json::array())) {
    if (!item.is_object()) continue;
    niuma::sqllsp::RoutineHit hit;
    hit.name = item.value("name", "");
    hit.type = item.value("type", "function");
    if (!hit.name.empty()) out.push_back(std::move(hit));
  }

  // 包名：CALL / schema. 点号槽
  const int remain =
      lp.limit > static_cast<int>(out.size()) ? lp.limit - static_cast<int>(out.size()) : 0;
  if (remain > 0) {
    tree::ListParams pp = lp;
    pp.limit = remain;
    std::string pkg_err;
    auto pkgs = tree::ListPackages(*s, pp, pkg_err);
    if (pkg_err.empty()) {
      if (pkgs.value("truncated", false)) truncated = true;
      for (const auto& item : pkgs.value("packages", nlohmann::json::array())) {
        if (!item.is_object()) continue;
        niuma::sqllsp::RoutineHit hit;
        hit.name = item.value("name", "");
        hit.type = "package";
        if (!hit.name.empty()) out.push_back(std::move(hit));
      }
    }
  } else {
    truncated = true;
  }
  return true;
}

}  // namespace niuma::oracle::lsp
