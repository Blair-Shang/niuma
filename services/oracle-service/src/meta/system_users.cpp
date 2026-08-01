#include "meta/system_users.hpp"

#include <algorithm>
#include <cctype>
#include <string>

namespace niuma::oracle::meta {
namespace {

std::string Upper(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  }
  return s;
}

}  // namespace

bool IsSystemSchema(const std::string& username) {
  const std::string u = Upper(username);
  // 常见系统 / 组件用户；可按产品需要扩展
  static const char* kSystem[] = {
      "SYS",
      "SYSTEM",
      "OUTLN",
      "DIP",
      "ORACLE_OCM",
      "DBSNMP",
      "APPQOSSYS",
      "DBSFWUSER",
      "GGSYS",
      "ANONYMOUS",
      "XDB",
      "XS$NULL",
      "GSMADMIN_INTERNAL",
      "GSMCATUSER",
      "GSMUSER",
      "SYSBACKUP",
      "SYSDG",
      "SYSKM",
      "SYSRAC",
      "AUDSYS",
      "OJVMSYS",
      "DVSYS",
      "DVF",
      "LBACSYS",
      "REMOTE_SCHEDULER_AGENT",
      "SYS$UMF",
      "DGPDB_INT",
      "MDDATA",
      "ORDDATA",
      "ORDPLUGINS",
      "ORDSYS",
      "SI_INFORMTN_SCHEMA",
      "WMSYS",
      "CTXSYS",
      "EXFSYS",
      "MDSYS",
      "OLAPSYS",
      "FLOWS_FILES",
      "APEX_PUBLIC_USER",
      "SPATIAL_CSW_ADMIN_USR",
      "SPATIAL_WFS_ADMIN_USR",
  };
  for (const char* name : kSystem) {
    if (u == name) {
      return true;
    }
  }
  // APEX_###### / ORDS_METADATA 等前缀
  if (u.rfind("APEX_", 0) == 0 || u.rfind("FLOWS_", 0) == 0) {
    return true;
  }
  return false;
}

}  // namespace niuma::oracle::meta
