#include "util/paths.hpp"

#include <cstdlib>
#include <filesystem>

#ifdef NIUMA_OS_WIN
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <unistd.h>
#include <limits.h>
#endif

namespace niuma::oracle::util {
namespace fs = std::filesystem;

std::string ExecutableDir() {
#ifdef NIUMA_OS_WIN
  wchar_t buf[MAX_PATH];
  const DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) {
    return ".";
  }
  fs::path p(buf);
  return p.parent_path().string();
#else
  char buf[PATH_MAX];
  const ssize_t n = ::readlink("/proc/self/exe", buf, sizeof(buf) - 1);
  if (n <= 0) {
    return ".";
  }
  buf[n] = '\0';
  return fs::path(buf).parent_path().string();
#endif
}

std::string OracleClientLibDir() {
  if (const char* env = std::getenv("NIUMA_ORACLE_RUNTIME"); env && *env) {
    return env;
  }
  if (const char* home = std::getenv("ORACLE_HOME"); home && *home) {
    return home;
  }
  const fs::path beside = fs::path(ExecutableDir()) / "runtime" / "oracle";
  if (fs::exists(beside)) {
    return beside.string();
  }
  // services/bin/niuma-oracle-service.exe → services/bin/runtime/oracle
  const fs::path alt = fs::path(ExecutableDir()) / ".." / "runtime" / "oracle";
  std::error_code ec;
  const auto canon = fs::weakly_canonical(alt, ec);
  if (!ec && fs::exists(canon)) {
    return canon.string();
  }
  return beside.string();
}

std::string DefaultIpcAddress() {
#ifdef NIUMA_OS_WIN
  return R"(\\.\pipe\niuma.oracle)";
#else
  return "/tmp/niuma.oracle.sock";
#endif
}

}  // namespace niuma::oracle::util
