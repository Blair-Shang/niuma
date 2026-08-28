#include <niuma/logutil/logutil.hpp>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <dbghelp.h>
#else
#include <csignal>
#include <unistd.h>
#endif

namespace niuma::logutil {
namespace {

namespace fs = std::filesystem;

std::string CrashServiceName;
fs::path CrashDumpPath;

fs::path CrashLogDir() {
  if (const char* dir = std::getenv("NIUMMA_LOG_DIR"); dir && *dir) {
    return fs::path(dir) / "crashes";
  }
  if (const char* root = std::getenv("NIUMMA_LOG_ROOT"); root && *root) {
    return fs::path(root) / "crashes";
  }
  return {};
}

#ifdef _WIN32
void WriteMinidump(EXCEPTION_POINTERS* info) {
  if (CrashDumpPath.empty()) {
    return;
  }
  HANDLE file = CreateFileW(CrashDumpPath.wstring().c_str(), GENERIC_WRITE, 0, nullptr,
                            CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    return;
  }
  MINIDUMP_EXCEPTION_INFORMATION mei{};
  mei.ThreadId = GetCurrentThreadId();
  mei.ExceptionPointers = info;
  mei.ClientPointers = FALSE;
  MiniDumpWriteDump(GetCurrentProcess(), GetCurrentProcessId(), file, MiniDumpNormal, info ? &mei : nullptr,
                    nullptr, nullptr);
  CloseHandle(file);
}

LONG WINAPI UnhandledFilter(EXCEPTION_POINTERS* info) {
  WriteMinidump(info);
  return EXCEPTION_CONTINUE_SEARCH;
}
#else
void CrashSignal(int sig) {
  if (!CrashDumpPath.empty()) {
    std::ofstream out(CrashDumpPath, std::ios::out | std::ios::app);
    out << "signal=" << sig << " pid=" << getpid() << "\n";
  }
  std::_Exit(128 + sig);
}
#endif

}  // namespace

bool InstallCrashDump(std::string_view service_name) {
  const fs::path dir = CrashLogDir();
  if (dir.empty()) {
    return false;
  }
  std::error_code ec;
  fs::create_directories(dir, ec);
  if (ec) {
    return false;
  }
  CrashServiceName = std::string(service_name);
#ifdef _WIN32
  CrashDumpPath = dir / (CrashServiceName + "-crash.dmp");
  SetUnhandledExceptionFilter(UnhandledFilter);
#else
  CrashDumpPath = dir / (CrashServiceName + "-crash.log");
  std::signal(SIGSEGV, CrashSignal);
  std::signal(SIGABRT, CrashSignal);
#endif
  return true;
}

}  // namespace niuma::logutil
