#pragma once

#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace niuma::oracle::dialect {

inline constexpr const char* kFamily = "oracle";

inline constexpr const char* kCapDoubleQuoteIdent = "oracle.double_quote_ident";
inline constexpr const char* kCapQQuote = "oracle.q_quote";
inline constexpr const char* kCapProcPlsqlBare = "proc.plsql_bare";
inline constexpr const char* kCapSplitPlsqlBlocks = "split.plsql_blocks";
inline constexpr const char* kCapScriptOracleSlash = "script.oracle_slash";
inline constexpr const char* kCapFormatPlsql = "format.plsql";
inline constexpr const char* kCapEditorBuiltinSql = "editor.builtin_sql";
inline constexpr const char* kCapEditorSqlLsp = "editor.sql_lsp";
inline constexpr const char* kCapRoutineCreateProcedure = "routine.create_procedure";
inline constexpr const char* kCapRoutineCreateFunction = "routine.create_function";
inline constexpr const char* kCapOraclePackage = "oracle.package";
inline constexpr const char* kCapSequenceNative = "sequence.native";
inline constexpr const char* kCapCdbPdb = "oracle.cdb_pdb";
inline constexpr const char* kCapIdentity = "oracle.identity";
inline constexpr const char* kCapJsonType = "oracle.json_type";

struct ServerProfile {
  std::string family{kFamily};
  std::string version;
  std::string version_num;
  std::string sql_compatibility;
  std::vector<std::string> capabilities;

  nlohmann::json ToJson() const;
};

std::string ParseVersionNum(const std::string& version);
ServerProfile ResolveCapabilities(const std::string& version, bool cdb_pdb);
ServerProfile DefaultProfile();

// 从 banner 判定是否为 Oracle；非 Oracle 返回 false。
bool LooksLikeOracle(const std::string& banner);
bool LooksLikeForeignEngine(const std::string& banner);

}  // namespace niuma::oracle::dialect
