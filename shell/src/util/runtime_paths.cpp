#include "util/runtime_paths.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#elif defined(__linux__)
#include <limits.h>
#include <unistd.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;

namespace niuma {

namespace {

constexpr char kPlatformUnixSocketName[] = "niuma.platform.sock";
constexpr char kPlatformUnixEventSocketName[] = "niuma.platform.events.sock";

fs::path ExeDirectory() {
#if defined(_WIN32)
  wchar_t buf[MAX_PATH];
  const DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH);
  if (n == 0) {
    return fs::current_path();
  }
  return fs::path(buf).parent_path();
#elif defined(__linux__)
  char buf[PATH_MAX];
  const ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
  if (n <= 0) {
    return fs::current_path();
  }
  buf[n] = '\0';
  return fs::path(buf).parent_path();
#elif defined(__APPLE__)
  char buf[PATH_MAX];
  uint32_t size = sizeof(buf);
  if (_NSGetExecutablePath(buf, &size) != 0) {
    return fs::current_path();
  }
  return fs::canonical(fs::path(buf)).parent_path();
#else
  return fs::current_path();
#endif
}

bool IsMacAppBundle(const fs::path& exe_dir) {
#if defined(__APPLE__)
  return exe_dir.filename() == "MacOS" && exe_dir.parent_path().filename() == "Contents";
#else
  (void)exe_dir;
  return false;
#endif
}

fs::path MacContentsDir(const fs::path& exe_dir) {
  return exe_dir.parent_path();
}

}  // namespace

std::string GetRuntimePlatformName() {
#if defined(_WIN32)
  return "windows";
#elif defined(__APPLE__)
  return "macos";
#elif defined(__linux__)
  std::ifstream os_release("/etc/os-release");
  if (os_release) {
    std::string content((std::istreambuf_iterator<char>(os_release)),
                        std::istreambuf_iterator<char>());
    if (content.find("kylin") != std::string::npos ||
        content.find("Kylin") != std::string::npos) {
      return "kylin";
    }
  }
  return "linux";
#else
  return "unknown";
#endif
}

std::string GetInstallDir() {
  return ExeDirectory().string();
}

std::string GetRuntimeDir() {
#if defined(_WIN32)
  const char* local = std::getenv("LOCALAPPDATA");
  if (local) {
    return std::string(local) + "\\NiuMa\\run\\";
  }
#elif defined(__APPLE__)
  const char* home = std::getenv("HOME");
  if (home) {
    return std::string(home) + "/Library/Application Support/NiuMa/run/";
  }
#else
  if (const char* env = std::getenv("NIUMMA_RUNTIME_DIR")) {
    if (env[0] != '\0') {
      std::string dir = env;
      if (!dir.empty() && dir.back() != '/') {
        dir += '/';
      }
      return dir;
    }
  }
  if (const char* xdg = std::getenv("XDG_DATA_HOME")) {
    return std::string(xdg) + "/NiuMa/run/";
  }
  if (const char* home = std::getenv("HOME")) {
    return std::string(home) + "/.local/share/NiuMa/run/";
  }
#endif
  return GetInstallDir() + "/run/";
}

std::string GetWebResourcesPath() {
  const fs::path exe_dir = ExeDirectory();
#if defined(__APPLE__)
  if (IsMacAppBundle(exe_dir)) {
    return (MacContentsDir(exe_dir) / "Resources" / "web").string();
  }
#endif
  return (exe_dir / NIUMMA_RESOURCES_DIR / "web").string();
}

std::string GetCefResourcesDir() {
  const fs::path exe_dir = ExeDirectory();
#if defined(__APPLE__)
  if (IsMacAppBundle(exe_dir)) {
    return (MacContentsDir(exe_dir) / "Resources").string();
  }
#endif
  return exe_dir.string();
}

std::string GetCefLocalesDir() {
  const fs::path resources = GetCefResourcesDir();
#if defined(__APPLE__)
  if (IsMacAppBundle(ExeDirectory())) {
    return (fs::path(resources) / "locales").string();
  }
#endif
  return (fs::path(resources) / "locales").string();
}

std::string GetPlatformIpcAddress() {
#if defined(_WIN32)
  return R"(\\.\pipe\niuma.platform)";
#else
  return (fs::temp_directory_path() / kPlatformUnixSocketName).string();
#endif
}

std::string GetPlatformEventAddress() {
#if defined(_WIN32)
  return R"(\\.\pipe\niuma.platform.events)";
#else
  return (fs::temp_directory_path() / kPlatformUnixEventSocketName).string();
#endif
}

std::string GetPluginsPath() {
  if (const char* env = std::getenv("NIUMMA_PLUGINS_DIR")) {
    if (env[0] != '\0') {
      return env;
    }
  }
  const fs::path exe_dir = ExeDirectory();
#if defined(__APPLE__)
  if (IsMacAppBundle(exe_dir)) {
    return (MacContentsDir(exe_dir) / "Resources" / "plugins").string();
  }
#endif
  return (exe_dir / NIUMMA_RESOURCES_DIR / "plugins").string();
}

}  // namespace niuma
