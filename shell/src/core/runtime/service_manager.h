#pragma once

#include "core/runtime/service_manifest.h"

#include <string>
#include <unordered_map>
#include <unordered_set>

namespace niuma {

/**
 * @brief 后端子进程生命周期管理：读 manifest、按需启停进程。
 *
 * 不裁决权限、不解析业务字段；仅负责「服务是否在跑」与进程句柄的 RAII 释放。
 * 进程内单例，方法在 CEF UI 线程调用，故 EnsureRunning 必须快速返回、不阻塞。
 */
class ServiceManager {
 public:
  /// @brief 返回全局单例。
  static ServiceManager& Instance();

  /**
   * @brief 初始化：记录安装目录并加载 manifest。
   *
   * @param install_dir 安装根目录（可执行文件所在目录），用于拼接服务可执行路径。
   */
  void Init(const std::string& install_dir);

  /**
   * @brief 确保目标服务处于运行态；必要时拉起其子进程。
   *
   * 解析规则：除已在 BridgeRouter 本地处理的 `shell.*` 外，一律映射到
   * manifest `com.niuma.platform`（由 platform-core 再代理到各能力服务）。
   * 若本会话已登记运行中，则立即返回、不探管道（避免 UI 线程 WaitNamedPipe）。
   * 尚未登记时探测监听或 spawn。本方法**不等待**管道就绪（PlatformClient 会在工作线程上带重试连接）。
   *
   * @param service_id 由 method 解析出的服务段（如 `platform.settings`）；当前均映射 platform-core。
   * @return 服务已在运行或已成功拉起返回 true；manifest 缺失或启动失败返回 false。
   */
  bool EnsureRunning(const std::string& service_id);

  /**
   * @brief 终止所有由本管理器 spawn 的子进程并关闭句柄。
   *
   * 只杀本进程 spawn 过的子进程。Windows：先关 Job 再 TerminateProcess 兜底。
   * Unix：SIGTERM，超时 SIGKILL 并 waitpid。不杀外部已在听的 platform。
   * 不在此重拉进程。关闭顺序应先于 CefShutdown。
   */
  void ShutdownAll();

  /// @brief 当前视为运行中的服务数量。
  size_t RunningCount() const { return running_ids_.size(); }

 private:
  ServiceManager() = default;

  /// @brief 由 spawn 产生、需在退出时回收的进程/作业句柄（HANDLE 存为 void*）。
  struct SpawnedProcess {
    void* process_handle = nullptr;
    void* thread_handle = nullptr;
    /// Windows Job Object：关闭时级联终止 platform 及其拉起的 niuma-* 能力服务。
    void* job_handle = nullptr;
  };

  /// @brief 把 Bridge 请求映射为 platform-core manifest（壳层不直接拉起能力服务）。
  const ServiceManifest* ResolveManifest(const std::string& service_id) const;

  /**
   * @brief 探测服务地址是否已可连接（命名管道 / UDS）。
   *
   * Windows 上 WaitNamedPipe 在实例全忙时最多阻塞 kListenProbeTimeoutMs。
   * 仅供 EnsureRunning 在尚未登记时调用，禁止放进每个 Bridge 请求的热路径。
   */
  bool IsServiceListening(const ServiceManifest& manifest) const;

  /// @brief 按 manifest 拉起子进程；成功时登记到 spawned_。
  bool SpawnService(const ServiceManifest& manifest);

  /**
   * @brief 本管理器 spawn 的进程是否仍在运行。
   *
   * Unix 会先 waitpid(WNOHANG) 收掉僵尸再判断；不能只靠 kill(pid,0)，
   * 否则已退出的 platform-core 会被当成还活着，既不重拉也不释放。
   */
  bool IsSpawnedProcessAlive(const SpawnedProcess& proc) const;

  /// @brief 释放进程/线程/作业句柄；可选终止仍存活的进程。
  void ReleaseSpawned(SpawnedProcess& proc, bool terminate_if_alive);

  /// @brief 清除某服务的 spawn 登记与运行标记。
  void ClearSpawnedState(const std::string& service_id);

  std::string install_dir_;
  ServiceManifestLoader loader_;
  std::unordered_set<std::string> running_ids_;
  std::unordered_map<std::string, SpawnedProcess> spawned_;
};

}  // namespace niuma
