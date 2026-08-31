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
#if defined(__linux__)
#include <sys/prctl.h>
#endif
#endif

namespace fs = std::filesystem;

namespace niuma {

namespace {

#if defined(_WIN32)
/// 探测服务地址是否在监听的超时（毫秒）；仅当管道存在但实例繁忙时才会真正阻塞。
/// EnsureRunning 热路径不得调用 IsServiceListening，避免在 CEF UI 线程上踩到此时限。
constexpr int kListenProbeTimeoutMs = 200;
#endif
/// 退出时等待子进程结束的超时（毫秒）；超时后再强杀，避免 ShutdownAll 卡死。
constexpr int kTerminateWaitMs = 3000;
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
#if defined(__linux__)
    // 壳被杀时内核给 platform-core 发 SIGKILL，避免主进程没了后台还在。
    prctl(PR_SET_PDEATHSIG, SIGKILL);
    if (getppid() == 1) {
      _exit(0);
    }
#endif
    // 子进程：工作目录必须切到安装目录；失败则立刻退出，避免带着错误 cwd 拉起服务。
    if (::chdir(install_dir_.c_str()) != 0) {
      _exit(127);
    }
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
  // 先收尸：platform-core 已退出而壳未 waitpid 时是僵尸，kill(0) 仍成功，
  // 会被误判为还活着，从而既不重拉也不释放管道。
  int status = 0;
  const pid_t waited = waitpid(pid, &status, WNOHANG);
  if (waited == pid || (waited < 0 && errno == ECHILD)) {
    return false;
  }
  return kill(pid, 0) == 0 || errno == EPERM;
#endif
}

void ServiceManager::ReleaseSpawned(SpawnedProcess& proc, bool terminate_if_alive) {
#if defined(_WIN32)
  // 先关 Job：KILL_ON_JOB_CLOSE 会杀掉 platform-core 以及继承进该 Job 的
  // 能力服务。若先 TerminateProcess(platform)，其 defer Shutdown 不会跑，
  // 孙进程只能靠 Job 继承或 platform 自己的 Job 关闭来收，缺口更大。
  if (proc.job_handle) {
    CloseHandle(static_cast<HANDLE>(proc.job_handle));
    proc.job_handle = nullptr;
  }
  if (terminate_if_alive && proc.process_handle && IsSpawnedProcessAlive(proc)) {
    TerminateProcess(static_cast<HANDLE>(proc.process_handle), 0);
    WaitForSingleObject(static_cast<HANDLE>(proc.process_handle), kTerminateWaitMs);
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
    const int steps = kTerminateWaitMs / 50;
    bool reaped = false;
    for (int i = 0; i < steps; ++i) {
      if (waitpid(pid, nullptr, WNOHANG) == pid) {
        reaped = true;
        break;
      }
      usleep(50 * 1000);
    }
    if (!reaped) {
      kill(pid, SIGKILL);
      waitpid(pid, nullptr, 0);
    }
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

  // 热路径：本会话已登记则不再 WaitNamedPipe。管道繁忙时探测会在 CEF UI
  // 线程卡住 kListenProbeTimeoutMs，后续 cefQuery（关连接、调终端大小等）全部排队。
  if (running_ids_.count(id)) {
    auto it = spawned_.find(id);
    if (it == spawned_.end()) {
      // 外部已拉起的 platform-core（如 pnpm dev:platform），无本进程 spawn 记录。
      return true;
    }
    if (IsSpawnedProcessAlive(it->second)) {
      return true;
    }
    ClearSpawnedState(id);
  }

  if (IsServiceListening(*manifest)) {
    running_ids_.insert(id);
    return true;
  }

  if (SpawnService(*manifest)) {
    running_ids_.insert(id);
    return true;
  }
  return false;
}

void ServiceManager::ShutdownAll() {
  // 只回收本进程 SpawnService 记下的子进程。探测到、但不是自己拉起的
  // platform（dev:platform 或上次崩溃残留）不杀，避免误杀外部调试进程。
  for (auto& entry : spawned_) {
    ReleaseSpawned(entry.second, true);
  }
  spawned_.clear();
  running_ids_.clear();
}

}  // namespace niuma
