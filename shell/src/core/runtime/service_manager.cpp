#include "core/runtime/service_manager.h"
#include "util/session_log.h"

#include <cstdint>
#include <cstdio>
#include <cerrno>
#include <filesystem>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <signal.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;

namespace niuma {

namespace {

#if defined(_WIN32)
/// 探测服务地址是否在监听的超时（毫秒）；仅当管道存在但实例繁忙时才会真正阻塞。
constexpr int kListenProbeTimeoutMs = 200;
/// 退出时等待子进程结束的超时（毫秒）。
constexpr int kTerminateWaitMs = 3000;
#endif
/// Platform 服务的 manifest id。
constexpr char kPlatformServiceId[] = "com.niuma.platform";

}  // namespace

ServiceManager& ServiceManager::Instance() {
  static ServiceManager instance;
  return instance;
}

void ServiceManager::Init(const std::string& install_dir) {
  install_dir_ = install_dir;
  loader_.LoadFromDirectory(install_dir_ + "/services/manifests");
}

const ServiceManifest* ServiceManager::ResolveManifest(
    const std::string& service_id) const {
  (void)service_id;
  // 壳层只拉起 platform-core；除 shell.* 等本地方法外，其余 Bridge 均由其代理转发。
  return loader_.Find(kPlatformServiceId);
}

bool ServiceManager::IsServiceListening(const ServiceManifest& manifest) const {
#if defined(_WIN32)
  if (manifest.transport != "named_pipe" || manifest.address.empty()) {
    return false;
  }
  // 管道地址为 ASCII，可逐字符加宽。
  const std::wstring addr_w(manifest.address.begin(), manifest.address.end());
  return WaitNamedPipeW(addr_w.c_str(), kListenProbeTimeoutMs) != 0;
#else
  if (manifest.transport != "unix_socket" || manifest.address.empty()) {
    return false;
  }
  const int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    return false;
  }
  sockaddr_un addr{};
  addr.sun_family = AF_UNIX;
  if (manifest.address.size() >= sizeof(addr.sun_path)) {
    close(fd);
    return false;
  }
  std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", manifest.address.c_str());
  const bool ok =
      connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0;
  close(fd);
  return ok;
#endif
}

bool ServiceManager::SpawnService(const ServiceManifest& manifest) {
#if defined(_WIN32)
  const fs::path exe = fs::path(install_dir_) / fs::path(manifest.executable);
  std::error_code ec;
  if (!fs::exists(exe, ec)) {
    AppendShellLog("spawn failed: executable not found: " + exe.string());
    return false;
  }

  const std::wstring exe_w = exe.wstring();
  const std::wstring cwd_w = fs::path(install_dir_).wstring();

  STARTUPINFOW startup_info{};
  startup_info.cb = sizeof(startup_info);
  PROCESS_INFORMATION process_info{};

  const BOOL ok = CreateProcessW(
      exe_w.c_str(),
      /*lpCommandLine*/ nullptr,
      /*lpProcessAttributes*/ nullptr,
      /*lpThreadAttributes*/ nullptr,
      /*bInheritHandles*/ FALSE,
      /*dwCreationFlags*/ CREATE_NO_WINDOW,
      /*lpEnvironment*/ nullptr,
      /*lpCurrentDirectory*/ cwd_w.c_str(),
      &startup_info, &process_info);
  if (!ok) {
    AppendShellLog("spawn failed: CreateProcessW for " + manifest.id);
    return false;
  }

  AppendShellLog("spawned " + manifest.id);

  SpawnedProcess record;
  record.process_handle = process_info.hProcess;
  record.thread_handle = process_info.hThread;

  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (job) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION job_info{};
    job_info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (SetInformationJobObject(job, JobObjectExtendedLimitInformation, &job_info,
                                sizeof(job_info))) {
      if (AssignProcessToJobObject(job, process_info.hProcess)) {
        record.job_handle = job;
      } else {
        CloseHandle(job);
        AppendShellLog("AssignProcessToJobObject failed for " + manifest.id);
      }
    } else {
      CloseHandle(job);
    }
  }

  spawned_[manifest.id] = record;
  return true;
#else
  const fs::path exe = fs::path(install_dir_) / fs::path(manifest.executable);
  std::error_code ec;
  if (!fs::exists(exe, ec)) {
    AppendShellLog("spawn failed: executable not found: " + exe.string());
    return false;
  }

  const pid_t pid = fork();
  if (pid < 0) {
    AppendShellLog("spawn failed: fork for " + manifest.id);
    return false;
  }
  if (pid == 0) {
    ::chdir(install_dir_.c_str());
    execl(exe.c_str(), exe.c_str(), static_cast<char*>(nullptr));
    _exit(127);
  }

  AppendShellLog("spawned " + manifest.id);
  SpawnedProcess record;
  record.process_handle = reinterpret_cast<void*>(static_cast<intptr_t>(pid));
  spawned_[manifest.id] = record;
  return true;
#endif
}

bool ServiceManager::IsSpawnedProcessAlive(const SpawnedProcess& proc) const {
#if defined(_WIN32)
  if (!proc.process_handle) {
    return false;
  }
  DWORD code = 0;
  if (!GetExitCodeProcess(static_cast<HANDLE>(proc.process_handle), &code)) {
    return false;
  }
  return code == STILL_ACTIVE;
#else
  const pid_t pid = static_cast<pid_t>(reinterpret_cast<intptr_t>(proc.process_handle));
  if (pid <= 0) {
    return false;
  }
  return kill(pid, 0) == 0 || errno == EPERM;
#endif
}

void ServiceManager::ReleaseSpawned(SpawnedProcess& proc, bool terminate_if_alive) {
#if defined(_WIN32)
  if (terminate_if_alive && proc.process_handle && IsSpawnedProcessAlive(proc)) {
    TerminateProcess(static_cast<HANDLE>(proc.process_handle), 0);
    WaitForSingleObject(static_cast<HANDLE>(proc.process_handle), kTerminateWaitMs);
  }
  if (proc.job_handle) {
    CloseHandle(static_cast<HANDLE>(proc.job_handle));
    proc.job_handle = nullptr;
  }
  if (proc.process_handle) {
    CloseHandle(static_cast<HANDLE>(proc.process_handle));
    proc.process_handle = nullptr;
  }
  if (proc.thread_handle) {
    CloseHandle(static_cast<HANDLE>(proc.thread_handle));
    proc.thread_handle = nullptr;
  }
#else
  const pid_t pid = static_cast<pid_t>(reinterpret_cast<intptr_t>(proc.process_handle));
  if (terminate_if_alive && pid > 0 && IsSpawnedProcessAlive(proc)) {
    kill(pid, SIGTERM);
    waitpid(pid, nullptr, 0);
  } else if (pid > 0) {
    waitpid(pid, nullptr, WNOHANG);
  }
  proc.process_handle = nullptr;
  proc.thread_handle = nullptr;
  proc.job_handle = nullptr;
#endif
}

void ServiceManager::ClearSpawnedState(const std::string& service_id) {
  auto it = spawned_.find(service_id);
  if (it != spawned_.end()) {
    ReleaseSpawned(it->second, true);
    spawned_.erase(it);
  }
  running_ids_.erase(service_id);
}

bool ServiceManager::EnsureRunning(const std::string& service_id) {
  const ServiceManifest* manifest = ResolveManifest(service_id);
  if (!manifest) {
    return false;
  }
  const std::string& id = manifest->id;

  if (IsServiceListening(*manifest)) {
    running_ids_.insert(id);
    return true;
  }

  if (running_ids_.count(id)) {
    auto it = spawned_.find(id);
    if (it != spawned_.end() && IsSpawnedProcessAlive(it->second)) {
      // 进程仍在但管道未就绪：保留登记，由 PlatformClient 重试连接。
      return true;
    }
    ClearSpawnedState(id);
  }

  if (SpawnService(*manifest)) {
    running_ids_.insert(id);
    return true;
  }
  return false;
}

void ServiceManager::ShutdownAll() {
#if defined(_WIN32)
  for (auto& entry : spawned_) {
    ReleaseSpawned(entry.second, false);
  }
#else
  for (auto& entry : spawned_) {
    ReleaseSpawned(entry.second, true);
  }
#endif
  spawned_.clear();
  running_ids_.clear();
}

}  // namespace niuma
