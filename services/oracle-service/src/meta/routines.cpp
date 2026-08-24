#include "meta/routines.hpp"

#include "dataio/script_split.hpp"
#include "meta/metadata_ddl.hpp"
#include "session/sql_rows.hpp"
#include "util/dpi_error.hpp"
#include "util/ident.hpp"
#include "util/lob.hpp"
#include "util/sql_literal.hpp"
#include "util/stmt_guard.hpp"

#include <cctype>
#include <cstdlib>
#include <sstream>

namespace niuma::oracle::meta {
namespace {

std::string DpiError(dpiContext* ctx) {
  return util::FormatDpiError(ctx, "oracle: routines error");
}

std::string Lower(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return s;
}

std::string Upper(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  }
  return s;
}

std::string Trim(std::string s) {
  while (!s.empty() && (s.front() == ' ' || s.front() == '\t')) {
    s.erase(s.begin());
  }
  while (!s.empty() && (s.back() == ' ' || s.back() == '\t' || s.back() == '\r' || s.back() == '\n')) {
    s.pop_back();
  }
  return s;
}

int ParseIntCell(const std::string& s, int fallback = 0) {
  const std::string t = Trim(s);
  if (t.empty()) return fallback;
  char* end = nullptr;
  const long v = std::strtol(t.c_str(), &end, 10);
  if (end == t.c_str()) return fallback;
  return static_cast<int>(v);
}

std::string NormalizeArgumentMode(const std::string& mode) {
  const std::string m = Upper(Trim(mode));
  if (m == "OUT") return "OUT";
  if (m == "IN/OUT" || m == "INOUT" || m == "IN OUT") return "INOUT";
  if (m == "IN" || m.empty()) return "IN";
  return m;
}

std::string BuildDtdIdentifier(const std::string& data_type, int length, int precision, int scale) {
  const std::string dt = Trim(data_type);
  if (dt.empty()) return {};
  const std::string upper = Upper(dt);
  if (precision > 0) {
    if (scale > 0) {
      std::ostringstream oss;
      oss << dt << '(' << precision << ',' << scale << ')';
      return oss.str();
    }
    std::ostringstream oss;
    oss << dt << '(' << precision << ')';
    return oss.str();
  }
  if (length > 0 &&
      (upper.find("CHAR") != std::string::npos || upper.find("RAW") != std::string::npos ||
       upper.find("BYTE") != std::string::npos)) {
    std::ostringstream oss;
    oss << dt << '(' << length << ')';
    return oss.str();
  }
  return dt;
}

bool IsRoutineReturnArg(const std::string& kind, int position, const std::string& arg_name) {
  if (kind != "function") return false;
  if (position == 0) return true;
  return Trim(arg_name).empty();
}

bool GetMetadataDDL(session::Session& session, const std::string& object_type, const std::string& name,
                    const std::string& schema, std::string& ddl, std::string& error) {
  return FetchDbmsMetadataDdl(session, object_type, schema, name, ddl, error);
}

std::string LoadAllSource(session::Session& session, const std::string& schema, const std::string& name,
                          const std::string& type, std::string& error) {
  // 大小写不敏感；ALL_SOURCE.TEXT 以 PROCEDURE/FUNCTION/PACKAGE 开头，无 CREATE。
  const std::string sql =
      "SELECT TEXT FROM ALL_SOURCE WHERE UPPER(OWNER) = UPPER(" + util::QuoteLiteral(schema) +
      ") AND NAME IN (" + util::QuoteLiteral(name) + ", UPPER(" + util::QuoteLiteral(name) +
      ")) AND TYPE = " + util::QuoteLiteral(type) + " ORDER BY LINE";
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

/** ALL_SOURCE 正文补 CREATE OR REPLACE，便于前端直接保存执行。 */
std::string EnsureCreateOrReplacePrefix(std::string ddl) {
  ddl = dataio::StripSqlPlusTerminator(std::move(ddl));
  size_t i = 0;
  while (i < ddl.size() && (ddl[i] == ' ' || ddl[i] == '\t' || ddl[i] == '\r' || ddl[i] == '\n')) {
    ++i;
  }
  if (i > 0) ddl.erase(0, i);
  if (ddl.empty()) return ddl;

  const std::string head = Upper(ddl.substr(0, 48));
  if (head.rfind("CREATE OR REPLACE", 0) == 0) {
    return ddl;
  }
  if (head.rfind("CREATE", 0) == 0) {
    size_t j = 6;
    while (j < ddl.size() && (ddl[j] == ' ' || ddl[j] == '\t' || ddl[j] == '\n' || ddl[j] == '\r')) {
      ++j;
    }
    const std::string rest = Upper(ddl.substr(j, 16));
    if (rest.rfind("PROCEDURE", 0) == 0 || rest.rfind("FUNCTION", 0) == 0 ||
        rest.rfind("PACKAGE", 0) == 0 || rest.rfind("VIEW", 0) == 0 ||
        rest.rfind("TRIGGER", 0) == 0 || rest.rfind("TYPE", 0) == 0) {
      return "CREATE OR REPLACE " + ddl.substr(j);
    }
    return ddl;
  }
  if (head.rfind("PROCEDURE", 0) == 0 || head.rfind("FUNCTION", 0) == 0 ||
      head.rfind("PACKAGE", 0) == 0) {
    return "CREATE OR REPLACE " + ddl;
  }
  return ddl;
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

  std::string dict_owner;
  std::string dict_name;
  std::string resolve_err;
  if (!ResolveDictionaryObject(session, ref.schema, ref.name, meta_type, dict_owner, dict_name,
                               resolve_err)) {
    dict_owner = ref.schema;
    dict_name = ref.name;
  }

  std::string ddl;
  std::string ignore;
  if (GetMetadataDDL(session, meta_type, dict_name, dict_owner, ddl, ignore)) {
    return nlohmann::json{{"name", ref.name},
                          {"kind", kind},
                          {"definition", EnsureCreateOrReplacePrefix(std::move(ddl))}};
  }
  ddl = LoadAllSource(session, dict_owner, dict_name, meta_type, error);
  if (!error.empty()) {
    return {};
  }
  if (ddl.empty()) {
    error = "oracle: " + kind + " not found: " + ref.schema + "." + ref.name;
    return {};
  }
  return nlohmann::json{{"name", ref.name},
                        {"kind", kind},
                        {"definition", EnsureCreateOrReplacePrefix(std::move(ddl))}};
}

nlohmann::json GetPackageSource(session::Session& session, const PackageRef& ref, std::string& error) {
  if (ref.schema.empty() || !util::IsSafeIdent(ref.schema) || ref.name.empty() ||
      !util::IsSafeIdent(ref.name)) {
    error = "oracle: schema and name required";
    return {};
  }
  const std::string part = ref.part.empty() ? "both" : ref.part;
  nlohmann::json out{{"name", ref.name}, {"kind", "package"}};
  std::string embedded_body;

  // object_type：ALL_OBJECTS；meta_type：GET_DDL；source_type：ALL_SOURCE。
  // 包体三者不一致：GET_DDL 用 PACKAGE_BODY，字典/ALL_SOURCE 用 "PACKAGE BODY"。
  auto load_part = [&](const char* meta_type, const char* object_type, const char* source_type,
                       const char* field) -> bool {
    std::string dict_owner;
    std::string dict_name;
    std::string resolve_err;
    if (!ResolveDictionaryObject(session, ref.schema, ref.name, object_type, dict_owner, dict_name,
                                 resolve_err)) {
      dict_owner = ref.schema;
      dict_name = ref.name;
    }
    std::string ddl;
    std::string ignore;
    if (!GetMetadataDDL(session, meta_type, dict_name, dict_owner, ddl, ignore)) {
      ddl = LoadAllSource(session, dict_owner, dict_name, source_type, error);
      if (!error.empty()) {
        return false;
      }
    }
    if (!ddl.empty()) {
      out[field] = EnsureCreateOrReplacePrefix(std::move(ddl));
    }
    return true;
  };

  if (part == "spec" || part == "both") {
    if (!load_part("PACKAGE", "PACKAGE", "PACKAGE", "definition")) {
      return {};
    }
    // GET_DDL('PACKAGE') + SQLTERMINATOR 时常把包体一并返回；拆出避免与 bodyDefinition 重复。
    if (out.contains("definition") && out["definition"].is_string()) {
      std::string spec;
      dataio::SplitPackageSpecBody(out["definition"].get<std::string>(), spec, embedded_body);
      if (!spec.empty()) {
        out["definition"] = EnsureCreateOrReplacePrefix(std::move(spec));
      } else {
        out.erase("definition");
      }
      if (!embedded_body.empty()) {
        embedded_body = EnsureCreateOrReplacePrefix(std::move(embedded_body));
      }
    }
  }
  if (part == "body" || part == "both") {
    error.clear();
    if (!load_part("PACKAGE_BODY", "PACKAGE BODY", "PACKAGE BODY", "bodyDefinition")) {
      // 包体可选
      error.clear();
    }
    if (!out.contains("bodyDefinition") && !embedded_body.empty()) {
      out["bodyDefinition"] = std::move(embedded_body);
    }
  }
  if (!out.contains("definition") && !out.contains("bodyDefinition")) {
    error = "oracle: package not found: " + ref.schema + "." + ref.name;
    return {};
  }
  return out;
}

nlohmann::json ListRoutineParameters(session::Session& session, const RoutineRef& ref, std::string& error) {
  if (ref.schema.empty() || !util::IsSafeIdent(ref.schema) || ref.name.empty() ||
      !util::IsSafeIdent(ref.name)) {
    error = "oracle: schema and name required";
    return {};
  }
  const std::string kind = Lower(ref.kind);
  if (kind != "procedure" && kind != "function") {
    error = "oracle: kind required (procedure|function)";
    return {};
  }
  const std::string meta_type = kind == "function" ? "FUNCTION" : "PROCEDURE";

  // 字典精确名（含小写引号对象）；查不到时仍用入参做 UPPER 兜底。
  std::string dict_owner = ref.schema;
  std::string dict_name = ref.name;
  std::string resolve_err;
  if (!ResolveDictionaryObject(session, ref.schema, ref.name, meta_type, dict_owner, dict_name,
                               resolve_err)) {
    dict_owner = ref.schema;
    dict_name = ref.name;
  }

  // OBJECT_ID 对齐 ALL_OBJECTS，避免同名包过程/大小写歧义；NUMBER 用 TO_CHAR 便于 ODPI 文本拉取。
  const std::string owner_lit = util::QuoteLiteral(dict_owner);
  const std::string name_lit = util::QuoteLiteral(dict_name);
  const std::string sql =
      "SELECT TO_CHAR(a.POSITION), a.ARGUMENT_NAME, a.IN_OUT, a.DATA_TYPE, "
      "TO_CHAR(NVL(a.DATA_LENGTH, 0)), TO_CHAR(NVL(a.DATA_PRECISION, 0)), "
      "TO_CHAR(NVL(a.DATA_SCALE, 0)) "
      "FROM ALL_ARGUMENTS a WHERE a.OBJECT_ID = ("
      "SELECT OBJECT_ID FROM ("
      "SELECT o.OBJECT_ID FROM ALL_OBJECTS o WHERE UPPER(o.OWNER) = UPPER(" +
      owner_lit + ") AND o.OBJECT_TYPE = " + util::QuoteLiteral(meta_type) +
      " AND o.OBJECT_NAME IN (" + name_lit + ", UPPER(" + name_lit +
      ")) ORDER BY CASE WHEN o.OBJECT_NAME = " + name_lit +
      " THEN 0 ELSE 1 END FETCH FIRST 1 ROWS ONLY))"
      " AND a.PACKAGE_NAME IS NULL AND NVL(a.DATA_LEVEL, 0) = 0 "
      "ORDER BY a.POSITION, a.SEQUENCE";

  session::SqlRowsResult rows;
  if (!session::ExecStringRows(session, sql, 501, rows, error)) {
    return {};
  }

  // 个别环境 OBJECT_ID 子查询空时，回退 OWNER/OBJECT_NAME UPPER 匹配。
  if (rows.rows.empty()) {
    error.clear();
    const std::string fallback =
        "SELECT TO_CHAR(POSITION), ARGUMENT_NAME, IN_OUT, DATA_TYPE, "
        "TO_CHAR(NVL(DATA_LENGTH, 0)), TO_CHAR(NVL(DATA_PRECISION, 0)), "
        "TO_CHAR(NVL(DATA_SCALE, 0)) "
        "FROM ALL_ARGUMENTS WHERE UPPER(OWNER) = UPPER(" +
        owner_lit + ") AND UPPER(OBJECT_NAME) = UPPER(" + name_lit +
        ") AND PACKAGE_NAME IS NULL AND NVL(DATA_LEVEL, 0) = 0 "
        "ORDER BY POSITION, SEQUENCE";
    if (!session::ExecStringRows(session, fallback, 501, rows, error)) {
      return {};
    }
  }

  nlohmann::json out{{"name", ref.name}, {"kind", kind}, {"parameters", nlohmann::json::array()}};
  std::string return_type;
  auto& params = out["parameters"];

  for (const auto& row : rows.rows) {
    if (row.size() < 7) continue;
    const int position = ParseIntCell(row[0]);
    const std::string arg_name = Trim(row[1]);
    const std::string mode = NormalizeArgumentMode(row[2]);
    const std::string data_type = Trim(row[3]);
    const int length = ParseIntCell(row[4]);
    const int precision = ParseIntCell(row[5]);
    const int scale = ParseIntCell(row[6]);
    const std::string dtd = BuildDtdIdentifier(data_type, length, precision, scale);

    if (IsRoutineReturnArg(kind, position, arg_name)) {
      if (return_type.empty()) {
        return_type = !dtd.empty() ? dtd : data_type;
      }
      continue;
    }

    nlohmann::json p{
        {"ordinal", position},
        {"name", arg_name},
        {"mode", mode.empty() ? "IN" : mode},
        {"dataType", data_type},
        {"dtdIdentifier", dtd},
        {"isReturn", false},
    };
    params.push_back(std::move(p));
  }

  // POSITION 偶发从 0 起或重复；统一重编号为 1..n，避免调试网格 key 冲突。
  for (size_t i = 0; i < params.size(); ++i) {
    params[i]["ordinal"] = static_cast<int>(i + 1);
  }
  if (!return_type.empty()) {
    out["returnType"] = return_type;
  }
  return out;
}

}  // namespace niuma::oracle::meta
