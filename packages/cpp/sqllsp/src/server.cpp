#include "niuma/sqllsp/server.hpp"

#include "niuma/sqllsp/heuristic.hpp"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <unordered_set>

namespace niuma::sqllsp {
namespace {

std::string ToLowerCopy(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return s;
}

std::string TrimCopy(std::string s) {
  size_t b = 0;
  while (b < s.size() && std::isspace(static_cast<unsigned char>(s[b]))) ++b;
  size_t e = s.size();
  while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) --e;
  return s.substr(b, e - b);
}

bool HasId(const nlohmann::json& msg) {
  if (!msg.contains("id") || msg["id"].is_null()) return false;
  return true;
}

nlohmann::json ItemToJson(const CompletionItem& it) {
  nlohmann::json j{{"label", it.label}};
  if (it.kind) j["kind"] = it.kind;
  if (!it.detail.empty()) j["detail"] = it.detail;
  if (!it.insert_text.empty()) j["insertText"] = it.insert_text;
  if (!it.documentation.empty()) j["documentation"] = it.documentation;
  if (!it.sort_text.empty()) j["sortText"] = it.sort_text;
  return j;
}

const TableRef* FindTableRef(const std::vector<TableRef>& refs, const std::string& name) {
  const std::string lower = ToLowerCopy(name);
  for (const auto& r : refs) {
    if (ToLowerCopy(r.alias) == lower || ToLowerCopy(r.name) == lower) return &r;
  }
  return nullptr;
}

}  // namespace

Server::Server(DialectParser* parser_in, Catalog* catalog_in, Manager* conns_in, NotifyFn notify_in)
    : parser(parser_in), catalog(catalog_in), conns(conns_in), notify(std::move(notify_in)) {}

std::string Server::QuoteIdent(const std::string& name) const {
  const std::string trimmed = TrimCopy(name);
  if (trimmed.empty() || !parser) return trimmed;
  return parser->QuoteIdent(trimmed);
}

std::string Server::SuggestDB(const Connection& conn, const std::string& uri) const {
  Document doc;
  if (!uri.empty() && conn.docs.Get(uri, doc)) {
    const std::string db = TrimCopy(doc.suggest_database);
    if (!db.empty()) return db;
  }
  const std::string db = TrimCopy(conn.suggest_database);
  if (!db.empty()) return db;
  if (default_database) return TrimCopy(default_database(conn.session_id));
  return {};
}

std::string Server::SuggestSchema(const Connection& conn, const std::string& uri) const {
  Document doc;
  if (!uri.empty() && conn.docs.Get(uri, doc)) {
    const std::string sch = TrimCopy(doc.suggest_schema);
    if (!sch.empty()) return sch;
  }
  return TrimCopy(conn.suggest_schema);
}

void Server::EmitDiagnostics(const std::string& connection_id, const std::string& uri, int version,
                             const std::vector<Diagnostic>& diags) {
  if (!notify) return;
  nlohmann::json arr = nlohmann::json::array();
  for (const auto& d : diags) {
    arr.push_back({
        {"range",
         {{"start", {{"line", d.range.start.line}, {"character", d.range.start.character}}},
          {"end", {{"line", d.range.end.line}, {"character", d.range.end.character}}}}},
        {"severity", d.severity ? d.severity : 1},
        {"source", d.source.empty() ? source_name : d.source},
        {"message", d.message},
    });
  }
  nlohmann::json params{{"uri", uri}, {"diagnostics", arr}};
  if (version > 0) params["version"] = version;
  notify(connection_id, nlohmann::json{{"jsonrpc", "2.0"},
                                       {"method", "textDocument/publishDiagnostics"},
                                       {"params", params}});
}

nlohmann::json Server::Initialize() {
  auto triggers = trigger_characters;
  if (triggers.empty()) triggers = {".", " ", "\""};
  return {
      {"capabilities",
       {{"textDocumentSync", {{"openClose", true}, {"change", 1}}},
        {"completionProvider", {{"triggerCharacters", triggers}}},
        {"hoverProvider", true},
        {"signatureHelpProvider", {{"triggerCharacters", nlohmann::json::array({"(", ","})}}}}},
      {"serverInfo", {{"name", source_name}, {"version", "0.4.0"}}},
  };
}

bool Server::DidOpen(Connection& conn, const nlohmann::json& params, std::string& error) {
  try {
    const auto& td = params.at("textDocument");
    const std::string uri = td.at("uri").get<std::string>();
    const int version = td.value("version", 1);
    const std::string text = td.value("text", "");
    conn.docs.Put(uri, version, text);
    std::vector<Diagnostic> diags;
    if (parser) diags = parser->Diagnostics(uri, text);
    EmitDiagnostics(conn.id, uri, version, diags);
    return true;
  } catch (const std::exception& e) {
    error = e.what();
    return false;
  }
}

bool Server::DidChange(Connection& conn, const nlohmann::json& params, std::string& error) {
  try {
    const auto& td = params.at("textDocument");
    const std::string uri = td.at("uri").get<std::string>();
    const int version = td.value("version", 0);
    const auto& changes = params.at("contentChanges");
    if (!changes.is_array() || changes.empty()) return true;
    const std::string text = changes.back().value("text", "");
    conn.docs.Put(uri, version, text);
    std::vector<Diagnostic> diags;
    if (parser) diags = parser->Diagnostics(uri, text);
    EmitDiagnostics(conn.id, uri, version, diags);
    return true;
  } catch (const std::exception& e) {
    error = e.what();
    return false;
  }
}

bool Server::DidClose(Connection& conn, const nlohmann::json& params, std::string& error) {
  try {
    const std::string uri = params.at("textDocument").at("uri").get<std::string>();
    conn.docs.Erase(uri);
    EmitDiagnostics(conn.id, uri, 0, {});
    return true;
  } catch (const std::exception& e) {
    error = e.what();
    return false;
  }
}

bool Server::SetSuggestDatabase(Connection& conn, const nlohmann::json& params, std::string& error) {
  try {
    const std::string db = TrimCopy(params.value("database", ""));
    const std::string sch = TrimCopy(params.value("schema", ""));
    const std::string uri = TrimCopy(params.value("uri", ""));
    if (!uri.empty()) {
      conn.docs.SetSuggestDatabase(uri, db, sch);
      return true;
    }
    if (conns) {
      conns->UpdateSuggestDatabase(conn.id, db, sch);
    } else {
      conn.suggest_database = db;
      if (!sch.empty()) conn.suggest_schema = sch;
      else if (!db.empty()) conn.suggest_schema = db;
    }
    return true;
  } catch (const std::exception& e) {
    error = e.what();
    return false;
  }
}

nlohmann::json Server::Completion(Connection& conn, const nlohmann::json& params, std::string& error) {
  try {
    const std::string uri = params.at("textDocument").at("uri").get<std::string>();
    Position pos;
    pos.line = params.at("position").value("line", 0);
    pos.character = params.at("position").value("character", 0);

    Document doc;
    if (!conn.docs.Get(uri, doc)) {
      return {{"isIncomplete", false}, {"items", nlohmann::json::array()}};
    }

    CompletionContext cc;
    if (parser) {
      cc = parser->CompletionContext(doc.text, pos);
    }
    if (cc.expect.empty()) {
      cc.expect = {CompletionKind::Keyword, CompletionKind::Schema, CompletionKind::Table};
    }

    int limit = catalog_limit > 0 ? catalog_limit : kDefaultCatalogLimit;
    if (limit > kMaxCatalogLimit) limit = kMaxCatalogLimit;

    const std::string default_db = SuggestDB(conn, uri);
    std::string default_schema = SuggestSchema(conn, uri);
    if (default_schema.empty()) default_schema = default_db;

    const int offset = OffsetFromPosition(doc.text, pos);
    if (cc.tables.empty()) {
      cc.tables = ExtractTableRefs(doc.text, offset);
    }

    if (!cc.table.empty()) {
      std::string sch;
      std::string tbl;
      if (ResolveDotQualifier(cc.tables, cc.table, default_schema, sch, tbl)) {
        if (cc.schema.empty() || ToLowerCopy(cc.schema) == ToLowerCopy(cc.table)) {
          cc.schema = sch;
        }
        cc.table = tbl;
      }
    }

    std::string catalog_db = default_db;
    std::string schema = TrimCopy(cc.schema);
    if (schema.empty()) schema = default_schema;
    if (schema.empty()) schema = catalog_db;

    const std::string prefix = cc.prefix;
    std::vector<CompletionItem> items;
    bool incomplete = false;
    bool expect_table = false;
    bool expect_column = false;
    for (const auto k : cc.expect) {
      if (k == CompletionKind::Table) {
        expect_table = true;
        incomplete = true;
      }
      if (k == CompletionKind::Column) {
        expect_column = true;
        incomplete = true;
      }
      if (k == CompletionKind::Schema || k == CompletionKind::Routine) incomplete = true;
    }
    std::string kw_sort = "0_";
    if (expect_table && !expect_column) kw_sort = "2_";

    std::unordered_set<std::string> seen;
    auto add = [&](CompletionItem it) {
      const std::string key = std::to_string(it.kind) + ":" + ToLowerCopy(it.label);
      if (!seen.insert(key).second) return;
      items.push_back(std::move(it));
    };

    auto add_columns = [&](const std::string& sch, const std::string& table) {
      if (const TableRef* ref = FindTableRef(cc.tables, table); ref && ref->virtual_table) {
        for (const auto& col : ref->columns) {
          if (!prefix.empty() && ToLowerCopy(col).rfind(ToLowerCopy(prefix), 0) != 0) continue;
          add(CompletionItem{col, kLspField, "cte/derived", QuoteIdent(col), "", "0_" + col});
        }
        return;
      }
      if (!catalog || sch.empty() || table.empty()) return;
      CatalogParams p;
      p.session_id = conn.session_id;
      p.database = catalog_db;
      p.schema = sch;
      p.table = table;
      p.prefix = prefix;
      p.limit = limit;
      std::vector<ColumnHit> hits;
      bool trunc = false;
      std::string err;
      if (!catalog->ListColumns(p, hits, trunc, err)) return;
      if (trunc) incomplete = true;
      for (const auto& h : hits) {
        std::string detail = h.data_type;
        add(CompletionItem{h.name, kLspField, detail, QuoteIdent(h.name), "", "0_" + h.name});
      }
    };

    for (const auto kind : cc.expect) {
      switch (kind) {
        case CompletionKind::Keyword: {
          auto kws = cc.keywords;
          if (kws.empty() && parser) kws = parser->Keywords();
          for (const auto& kw : kws) {
            if (!prefix.empty() && ToLowerCopy(kw).rfind(ToLowerCopy(prefix), 0) != 0) continue;
            add(CompletionItem{kw, kLspKeyword, "", kw, "", kw_sort + kw});
          }
          // 与 Go sqllsp 对齐：方言片段挂在 Keyword 槽（CREATE PROCEDURE 等）
          for (const auto& sn : cc.snippets) {
            if (!prefix.empty() && ToLowerCopy(sn.label).rfind(ToLowerCopy(prefix), 0) != 0) continue;
            CompletionItem it = sn;
            if (!it.kind) it.kind = kLspSnippet;
            if (it.sort_text.empty()) it.sort_text = "2_" + it.label;
            if (it.detail.empty()) it.detail = "snippet";
            add(std::move(it));
          }
          break;
        }
        case CompletionKind::Schema: {
          if (!catalog) break;
          CatalogParams p;
          p.session_id = conn.session_id;
          p.database = catalog_db;
          p.prefix = prefix;
          p.limit = limit;
          std::vector<SchemaHit> hits;
          bool trunc = false;
          std::string err;
          if (!catalog->ListSchemas(p, hits, trunc, err)) break;
          if (trunc) incomplete = true;
          for (const auto& h : hits) {
            add(CompletionItem{h.name, kLspModule, "schema", QuoteIdent(h.name), "", "1_" + h.name});
          }
          break;
        }
        case CompletionKind::Table: {
          if (!catalog || schema.empty()) break;
          CatalogParams p;
          p.session_id = conn.session_id;
          p.database = catalog_db;
          p.schema = schema;
          p.prefix = prefix;
          p.limit = limit;
          std::vector<TableHit> hits;
          bool trunc = false;
          std::string err;
          if (!catalog->ListTables(p, hits, trunc, err)) break;
          if (trunc) incomplete = true;
          for (const auto& h : hits) {
            std::string detail = h.type.empty() ? "table" : h.type;
            detail += " · " + schema;
            const std::string sort_prefix = expect_column ? "1_" : "0_";
            add(CompletionItem{h.name, kLspClass, detail, QuoteIdent(h.name), "",
                               sort_prefix + h.name});
          }
          break;
        }
        case CompletionKind::Column: {
          const std::string table = TrimCopy(cc.table);
          if (!table.empty()) {
            add_columns(schema, table);
            break;
          }
          for (const auto& r : cc.tables) {
            if (r.virtual_table) {
              add_columns("", r.alias.empty() ? r.name : r.alias);
              continue;
            }
            std::string sch = TrimCopy(r.schema);
            if (sch.empty()) sch = default_schema;
            if (sch.empty()) sch = catalog_db;
            add_columns(sch, r.name);
          }
          break;
        }
        case CompletionKind::Function: {
          for (const auto& fn : cc.functions) {
            if (!prefix.empty() && ToLowerCopy(fn.label).rfind(ToLowerCopy(prefix), 0) != 0) continue;
            CompletionItem it = fn;
            if (!it.kind) it.kind = kLspFunction;
            if (it.sort_text.empty()) it.sort_text = "0f_" + it.label;
            if (it.detail.empty()) it.detail = "function";
            add(std::move(it));
          }
          break;
        }
        case CompletionKind::Routine: {
          auto* rc = dynamic_cast<RoutineCatalog*>(catalog);
          if (!rc || schema.empty()) break;
          CatalogParams p;
          p.session_id = conn.session_id;
          p.database = catalog_db;
          p.schema = schema;
          p.prefix = prefix;
          p.limit = limit;
          std::vector<RoutineHit> hits;
          bool trunc = false;
          std::string err;
          if (!rc->ListRoutines(p, hits, trunc, err)) break;
          if (trunc) incomplete = true;
          const std::string filter = ToLowerCopy(TrimCopy(cc.routine_filter));
          for (const auto& h : hits) {
            const std::string typ = ToLowerCopy(TrimCopy(h.type));
            // routine_filter=function 时隐藏 package/procedure（SELECT/WHERE 表达式槽）
            if (!filter.empty() && typ != filter) continue;
            const std::string quoted = QuoteIdent(h.name);
            if (typ == "package") {
              add(CompletionItem{h.name, kLspModule, "package · " + schema, quoted, "",
                                 "0k_" + h.name});
              continue;
            }
            const bool is_proc = typ == "procedure";
            add(CompletionItem{h.name, is_proc ? kLspMethod : kLspFunction,
                               is_proc ? "procedure" : "function", quoted + "(${1})", "",
                               (is_proc ? "0p_" : "0r_") + h.name});
          }
          break;
        }
        case CompletionKind::Snippet:
          for (const auto& sn : cc.snippets) {
            if (!prefix.empty() && ToLowerCopy(sn.label).rfind(ToLowerCopy(prefix), 0) != 0) continue;
            CompletionItem it = sn;
            if (!it.kind) it.kind = kLspSnippet;
            if (it.sort_text.empty()) it.sort_text = "2_" + it.label;
            add(std::move(it));
          }
          break;
      }
    }

    nlohmann::json arr = nlohmann::json::array();
    for (const auto& it : items) arr.push_back(ItemToJson(it));
    return {{"isIncomplete", incomplete}, {"items", arr}};
  } catch (const std::exception& e) {
    error = e.what();
    return {};
  }
}

std::optional<nlohmann::json> Server::HandleMessage(Connection& conn, const nlohmann::json& msg,
                                                    std::string& error) {
  error.clear();
  if (!msg.is_object() || !msg.contains("method") || !msg["method"].is_string()) {
    error = "json-rpc method required";
    return std::nullopt;
  }
  const std::string method = msg["method"].get<std::string>();
  const nlohmann::json params = msg.contains("params") ? msg["params"] : nlohmann::json::object();
  const bool is_req = HasId(msg);

  auto respond_ok = [&](nlohmann::json result) -> std::optional<nlohmann::json> {
    if (!is_req) return std::nullopt;
    return nlohmann::json{{"jsonrpc", "2.0"}, {"id", msg["id"]}, {"result", std::move(result)}};
  };
  auto respond_err = [&](const std::string& err) -> std::optional<nlohmann::json> {
    if (!is_req) {
      error = err;
      return std::nullopt;
    }
    return nlohmann::json{{"jsonrpc", "2.0"},
                          {"id", msg["id"]},
                          {"error", {{"code", -32603}, {"message", err}}}};
  };

  if (method == "initialize") {
    return respond_ok(Initialize());
  }
  if (method == "initialized" || method == "shutdown" || method == "exit") {
    return respond_ok(nullptr);
  }
  if (method == "textDocument/didOpen") {
    if (!DidOpen(conn, params, error)) return respond_err(error);
    return respond_ok(nullptr);
  }
  if (method == "textDocument/didChange") {
    if (!DidChange(conn, params, error)) return respond_err(error);
    return respond_ok(nullptr);
  }
  if (method == "textDocument/didClose") {
    if (!DidClose(conn, params, error)) return respond_err(error);
    return respond_ok(nullptr);
  }
  if (method == "niuma/setSuggestDatabase") {
    if (!SetSuggestDatabase(conn, params, error)) return respond_err(error);
    return respond_ok(nullptr);
  }
  if (method == "textDocument/completion") {
    auto result = Completion(conn, params, error);
    if (!error.empty()) return respond_err(error);
    return respond_ok(std::move(result));
  }
  if (method == "textDocument/hover" || method == "textDocument/documentSymbol" ||
      method == "textDocument/definition" || method == "textDocument/formatting" ||
      method == "textDocument/signatureHelp") {
    return respond_ok(nullptr);
  }
  return respond_err("method not found: " + method);
}

}  // namespace niuma::sqllsp
