#pragma once

#include <functional>
#include <string>

namespace niuma {

/// 应用 IPC 回调：ok 为成功标志，data 为业务结果 JSON 字符串，err 为失败原因。
using PlatformCallback =
    std::function<void(bool ok, const std::string& data, const std::string& err)>;

/** Platform 反向事件回调：参数为完整事件 JSON 字符串。 */
using PlatformEventCallback = std::function<void(const std::string& event_json)>;

/**
 * @brief ② 应用 IPC：Shell → Platform Core 的透传客户端（不解析业务、不持凭据）。
 *
 * 过渡期传输为 Windows 命名管道 `\\.\pipe\niuma.platform`，分帧为
 * 「4 字节小端长度前缀 + UTF-8 JSON」；未来升级为 gRPC。壳层只做字节搬运：
 * 把 Web 的原始请求 JSON 原样发给 Platform，再把响应回传，不落盘、不鉴权。
 *
 * @note 每次 `Invoke` 在独立工作线程上做阻塞管道 IO，绝不阻塞 CEF UI 线程；
 *       结果经 `CefPostTask(TID_UI, ...)` 回到 UI 线程后再触发回调。
 */
class PlatformClient {
 public:
  /**
   * @brief 向 Platform 透传一次请求并异步返回结果。
   *
   * @param service_id 由 method 解析出的服务段（如 `platform.settings`）；仅用于
   *                   诊断，线路上不单独发送（Platform 从 params_json 内解析 method）。
   * @param action     方法动作段（如 `get`）；同样仅用于诊断。
   * @param params_json Web 发来的**完整原始请求 JSON**（含 method/params/id），
   *                    原样成帧发送给 Platform。
   * @param callback   异步结果回调；成功时 ok=true 且 data 为结果 JSON，失败时
   *                   ok=false 且 err 含原因。**在 CEF UI 线程上被调用**。
   */
  void Invoke(const std::string& service_id, const std::string& action,
              const std::string& params_json, PlatformCallback callback);

  /**
   * @brief 关闭所有客户端资源（当前为短连接，无常驻连接需释放）。
   *
   * @note 每次 Invoke 使用一次性连接并 RAII 关闭句柄，故此处为空实现；保留接口
   *       以便未来 gRPC 长连接池的统一释放。
   */
  void ShutdownAll();

  /**
   * @brief 连接 Platform 事件管道并持续接收推送帧（独立线程，自动重连）。
   *
   * @param callback 每收到一帧事件 JSON 后在 CEF UI 线程调用。
   */
  static void StartEventListener(PlatformEventCallback callback);

  /** 停止事件监听（进程退出前调用）。 */
  static void StopEventListener();

  /**
   * @brief 设置流帧回调（与事件回调相同线程语义：CEF UI 线程）。
   *
   * 须在首次 `OpenStream` 前调用；帧内容为完整事件 JSON，由 Platform stream 管道推送。
   */
  static void SetStreamFrameCallback(PlatformEventCallback callback);

  /**
   * @brief 打开一条 Platform 长流：发送开流帧后持续读取并回调。
   *
   * @param open_request_json 开流请求 JSON（method/params/id），与 niuma.platform 同帧格式。
   * @param stream_id         Shell 侧会话标识，供 `CloseStream` 取消。
   */
  static void OpenStream(const std::string& open_request_json,
                         const std::string& stream_id);

  /** 关闭指定流会话（幂等）。 */
  static void CloseStream(const std::string& stream_id);

  /** 关闭全部流会话（进程退出前调用）。 */
  static void CloseAllStreams();
};

}  // namespace niuma
