#include "meta/routines.hpp"

#include "session/sql_rows.hpp"
#include "util/ident.hpp"
#include "util/lob.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

#include <cctype>

namespace niuma::oracle::meta {
namespace {

std::string DpiError(dpiContext* ctx) {
  dpiErrorInfo info{};
  if (ctx) {
    dpiContext_getError(ctx, &info);
  }
  if (info.message == nullptr) {
    return "oracle: meta error";
  }
  return std::string("oracle: ") + info.message;
}

std::string Lower(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return s;
}

bool GetMetadataDDL(session::Session& session, const std::string& object_type, const std::string& name,
                    const std::string& schema, std::string& ddl, std::string& error) {
  if (!session.conn || !session.ctx) {
    error = "oracle: session has no connection";
    return false;
  }
  const std::string sql = "SELECT DBMS_METADATA.GET_DDL(" + util::QuoteLiteral(object_type) + ", " +
                          util::QuoteLiteral(name) + ", " + util::QuoteLiteral(schema) + ") FROM DUAL";
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(session.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0,
                          &raw) < 0) {
    return false;
  }
  stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    return false;
  }
  int found = 0;
  uint32_t buffer_row = 0;
  if (dpiStmt_fetch(stmt.Get(), &found, &buffer_row) < 0 || !found) {
    return false;
  }
  dpiNativeTypeNum native = DPI_NATIVE_TYPE_BYTES;
  dpiData* data = nullptr;
  if (dpiStmt_getQueryValue(stmt.Get(), 1, &native, &data) < 0) {
    return false;
  }
  util::LobReadResult lob;
  if (!util::ReadLobData(session.ctx.get(), native, data, util::kLobFullMax, lob, error)) {
    return false;
  }
  ddl = lob.data;
  while (!ddl.empty() && (ddl.back() == '\n' || ddl.back() == '\r' || ddl.back() == ' ')) {
    ddl.pop_back();
  }
  return !ddl.empty();
}

std::string LoadAllSource(session::Session& session, const std::string& schema, const std::string& name,
                          const std::string& type, std::string& error) {
  const std::string sql =
      "SELECT TEXT FROM ALL_SOURCE WHERE OWNER = " + util::QuoteLiteral(schema) +
      " AND NAME = " + util::QuoteLiteral(name) + " AND TYPE = " + util::QuoteLiteral(type) +
      " ORDER BY LINE";
  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, 100001, rows, error)) {
    return {};
  }
  std::string out;
  for (const auto& row : rows.rows) {
    if (!row.empty()) {
      out += row[0];
    }
  }
  while (!out.empty() && (out.back() == '\n' || out.back() == '\r' || out.back() == ' ')) {
    out.pop_back();
  }
  return out;
}

}  // namespace

RoutineRef RoutineRef::FromJson(const nlohmann::json& j) {
  RoutineRef r;
  if (j.contains("schema") && j["schema"].is_string()) {
    r.schema = j["schema"].get<std::string>();
  }
  if (j.contains("name") && j["name"].is_string()) {
    r.name = j["name"].get<std::string>();
  } else if (j.contains("routine") && j["routine"].is_string()) {
    r.name = j["routine"].get<std::string>();
  } else if (j.contains("table") && j["table"].is_string()) {
    r.name = j["table"].get<std::string>();
  }
  if (j.contains("kind") && j["kind"].is_string()) {
    r.kind = j["kind"].get<std::string>();
  }
  return r;
}

PackageRef PackageRef::FromJson(const nlohmann::json& j) {
  PackageRef r;
  if (j.contains("schema") && j["schema"].is_string()) {
    r.schema = j["schema"].get<std::string>();
  }
  if (j.contains("name") && j["name"].is_string()) {
    r.name = j["name"].get<std::string>();
  } else if (j.contains("package") && j["package"].is_string()) {
    r.name = j["package"].get<std::string>();
  } else if (j.contains("routine") && j["routine"].is_string()) {
    r.name = j["routine"].get<std::string>();
  }
  if (j.contains("part") && j["part"].is_string()) {
    r.part = Lower(j["part"].get<std::string>());
  } else {
    r.part = "both";
  }
  return r;
}

nlohmann::json GetRoutineSource(session::Session& session, const RoutineRef& ref, std::string& error) {
  if (ref.schema.empty() || !util::IsSafeIdent(ref.schema) || ref.name.empty() ||
      !util::IsSafeIdent(ref.name)) {
    error = "oracle: schema and name required";
    return {};
  }
  const std::string kind = Lower(ref.kind);
  std::string meta_type;
  if (kind == "procedure") {
    meta_type = "PROCEDURE";
  } else if (kind == "function") {
    meta_type = "FUNCTION";
  } else {
    error = "oracle: kind required (procedure|function)";
    return {};
  }

  std::string ddl;
  std::string ignore;
  if (GetMetadataDDL(session, meta_type, ref.name, ref.schema, ddl, ignore)) {
    return nlohmann::json{{"name", ref.name}, {"kind", kind}, {"definition", ddl}};
  }
  ddl = LoadAllSource(session, ref.schema, ref.name, meta_type, error);
  if (!error.empty()) {
    return {};
  }
  if (ddl.empty()) {
    error = "oracle: " + kind + " not found: " + ref.schema + "." + ref.name;
    return {};
  }
  return nlohmann::json{{"name", ref.name}, {"kind", kind}, {"definition", ddl}};
}

nlohmann::json GetPackageSource(session::Session& session, const PackageRef& ref, std::string& error) {
  if (ref.schema.empty() || !util::IsSafeIdent(ref.schema) || ref.name.empty() ||
      !util::IsSafeIdent(ref.name)) {
    error = "oracle: schema and name required";
    return {};
  }
  const std::string part = ref.part.empty() ? "both" : ref.part;
  nlohmann::json out{{"name", ref.name}, {"kind", "package"}};

  auto load_part = [&](const char* meta_type, const char* source_type, const char* field) -> bool {
    std::string ddl;
    std::string ignore;
    if (!GetMetadataDDL(session, meta_type, ref.name, ref.schema, ddl, ignore)) {
      ddl = LoadAllSource(session, ref.schema, ref.name, source_type, error);
      if (!error.empty()) {
        return false;
      }
    }
    if (!ddl.empty()) {
      out[field] = ddl;
    }
    return true;
  };

  if (part == "spec" || part == "both") {
    if (!load_part("PACKAGE", "PACKAGE", "definition")) {
      return {};
    }
  }
  if (part == "body" || part == "both") {
    error.clear();
    if (!load_part("PACKAGE_BODY", "PACKAGE_BODY", "bodyDefinition")) {
      // 包体可选
      error.clear();
    }
  }
  if (!out.contains("definition") && !out.contains("bodyDefinition")) {
    error = "oracle: package not found: " + ref.schema + "." + ref.name;
    return {};
  }
  return out;
}

}  // namespace niuma::oracle::meta
