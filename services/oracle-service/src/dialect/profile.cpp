#include "dialect/profile.hpp"

#include <cctype>
#include <cstdio>
#include <regex>

namespace niuma::oracle::dialect {
namespace {

std::string ToLower(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return s;
}

int MajorFromVersion(const std::string& version) {
  static const std::regex re(R"((\d+)\.(\d+))");
  std::smatch m;
  if (!std::regex_search(version, m, re)) {
    return 0;
  }
  return std::stoi(m[1]);
}

}  // namespace

nlohmann::json ServerProfile::ToJson() const {
  nlohmann::json j{
      {"family", family},
      {"capabilities", capabilities},
  };
  if (!version.empty()) {
    j["version"] = version;
  }
  if (!version_num.empty()) {
    j["versionNum"] = version_num;
  }
  if (!sql_compatibility.empty()) {
    j["sqlCompatibility"] = sql_compatibility;
  }
  return j;
}

std::string ParseVersionNum(const std::string& version) {
  static const std::regex re(R"((\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?)");
  std::smatch m;
  if (!std::regex_search(version, m, re)) {
    return {};
  }
  const int major = std::stoi(m[1]);
  const int minor = std::stoi(m[2]);
  const int patch = m[3].matched ? std::stoi(m[3]) : 0;
  const int build = m[4].matched ? std::stoi(m[4]) : 0;
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%d%02d%02d%02d", major, minor, patch, build);
  return buf;
}

ServerProfile ResolveCapabilities(const std::string& version, bool cdb_pdb) {
  ServerProfile p;
  p.family = kFamily;
  p.version = version;
  p.version_num = ParseVersionNum(version);
  p.capabilities = {
      kCapDoubleQuoteIdent,       kCapQQuote,           kCapProcPlsqlBare, kCapSplitPlsqlBlocks,
      kCapScriptOracleSlash,      kCapFormatPlsql,      kCapEditorBuiltinSql, kCapRoutineCreateProcedure,
      kCapRoutineCreateFunction,  kCapOraclePackage,    kCapSequenceNative,
  };

  const int major = MajorFromVersion(version);
  if (cdb_pdb || major >= 12) {
    p.capabilities.push_back(kCapCdbPdb);
  }
  if (major >= 12 || major == 0) {
    p.capabilities.push_back(kCapIdentity);
  }
  if (major >= 21) {
    p.capabilities.push_back(kCapJsonType);
  }
  return p;
}

ServerProfile DefaultProfile() { return ResolveCapabilities("", false); }

bool LooksLikeForeignEngine(const std::string& banner) {
  const auto lower = ToLower(banner);
  return lower.find("postgres") != std::string::npos || lower.find("mysql") != std::string::npos ||
         lower.find("mariadb") != std::string::npos || lower.find("dameng") != std::string::npos ||
         lower.find("dm database") != std::string::npos;
}

bool LooksLikeOracle(const std::string& banner) {
  const auto lower = ToLower(banner);
  if (LooksLikeForeignEngine(banner)) {
    return false;
  }
  return lower.find("oracle") != std::string::npos;
}

}  // namespace niuma::oracle::dialect
