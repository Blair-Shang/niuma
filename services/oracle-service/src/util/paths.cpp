#include "util/paths.hpp"

#include <cstdlib>
#include <filesystem>
#include <string>
#include <vector>

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

namespace {

bool DirHasOracleClient(const fs::path& dir) {
  if (dir.empty()) {
    return false;
  }
  std::error_code ec;
  if (!fs::is_directory(dir, ec)) {
    return false;
  }
#ifdef NIUMA_OS_WIN
  return fs::exists(dir / "oci.dll", ec);
#else
  // Instant Client / ORACLE_HOME 常见布局
  if (fs::exists(dir / "libclntsh.so", ec)) {
    return true;
  }
  for (const auto& entry : fs::directory_iterator(dir, ec)) {
    if (ec) {
      break;
    }
    const auto name = entry.path().filename().string();
    if (name.rfind("libclntsh.so", 0) == 0) {
      return true;
    }
  }
  return false;
#endif
}

std::string FirstExistingClientDir(std::initializer_list<fs::path> candidates) {
  for (const auto& raw : candidates) {
    if (raw.empty()) {
      continue;
    }
    std::error_code ec;
    const auto canon = fs::weakly_canonical(raw, ec);
    const fs::path& dir = ec ? raw : canon;
    if (DirHasOracleClient(dir)) {
      return dir.string();
    }
  }
  return {};
}

#ifdef NIUMA_OS_WIN
std::vector<fs::path> PathEnvClientDirs() {
  std::vector<fs::path> out;
  const char* path_env = std::getenv("PATH");
  if (path_env == nullptr || *path_env == '\0') {
    return out;
  }
  std::string remaining(path_env);
  while (!remaining.empty()) {
    const auto pos = remaining.find(';');
    const std::string part = pos == std::string::npos ? remaining : remaining.substr(0, pos);
    if (pos == std::string::npos) {
      remaining.clear();
    } else {
      remaining.erase(0, pos + 1);
    }
    if (part.empty()) {
      continue;
    }
    out.emplace_back(part);
  }
  return out;
}
#endif

}  // namespace

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
  // 1) 标准 Oracle 客户端根目录（本机安装 / 工具组件注入 ORACLE_HOME）
  if (const char* home = std::getenv("ORACLE_HOME"); home && *home) {
    const fs::path home_path(home);
    if (DirHasOracleClient(home_path)) {
      return home_path.string();
    }
    if (fs::is_regular_file(home_path) && DirHasOracleClient(home_path.parent_path())) {
      return home_path.parent_path().string();
    }
    if (const auto found = FirstExistingClientDir({home_path / "bin"}); !found.empty()) {
      return found;
    }
  }

  // 2) 旁载目录（安装包 / stage-services，可选）
  const fs::path beside = fs::path(ExecutableDir()) / "runtime" / "oracle";
  const fs::path alt = fs::path(ExecutableDir()) / ".." / "runtime" / "oracle";
  if (const auto found = FirstExistingClientDir({beside, alt}); !found.empty()) {
    return found;
  }

#ifdef NIUMA_OS_WIN
  // 3) PATH 中含 oci.dll 的目录（Instant Client 常见用法）
  for (const auto& dir : PathEnvClientDirs()) {
    if (DirHasOracleClient(dir)) {
      return dir.string();
    }
  }
#endif

  // 回退：仍返回旁载约定路径，供 ODPI 报错信息定位
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
