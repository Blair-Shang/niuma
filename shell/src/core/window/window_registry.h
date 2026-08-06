#pragma once

#include "core/window/window_types.h"

#include <string>
#include <vector>

#if NIUMMA_WITH_CEF
#include "include/cef_browser.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

/** 已挂载的顶层 CEF 窗口记录 */
struct WindowRecord {
  int id = 0;
  WindowKind kind = WindowKind::Auxiliary;
  std::string title;
  std::string url;
  WindowCreateOptions chrome;
  CefRefPtr<CefBrowser> browser;
  /** Web 侧 shell.window.reveal 后为 true；Focus 在 false 时不 Show，避免首显前闪屏 */
  bool user_revealed = false;
};

/** CreateBrowserView 完成前暂存的待挂载信息 */
struct PendingWindow {
  int id = 0;
  WindowKind kind = WindowKind::Auxiliary;
  std::string title;
  std::string url;
  WindowCreateOptions chrome;
};

/**
 * 全进程窗口登记表（Main / Splash / Auxiliary / Popup 统一存储）。
 *
 * 仅负责 id 分配、pending 队列、查找与聚焦状态；不直接创建 CEF 窗口。
 * 业务语义由各管理器约束：MainWindow（主窗唯一）、SplashWindow（启动单例）、
 * AuxiliaryWindowManager（可多开 / route 复用）。
 */
class WindowRegistry {
 public:
  static WindowRegistry& Instance();

  int AllocateId();
  void EnqueuePending(PendingWindow pending);

  /** Browser 创建完成后，与队首 pending 配对并写入 windows_ */
  bool AttachBrowser(CefRefPtr<CefBrowser> browser, WindowRecord* attached);

  bool RemoveByBrowser(CefRefPtr<CefBrowser> browser);
  void UpdateTitle(CefRefPtr<CefBrowser> browser, const std::string& title);

  /** 精确查找：不做 focused / 首窗回退，适合类型判断与生命周期逻辑。 */
  const WindowRecord* FindExact(int window_id) const;
  const WindowRecord* Find(int window_id) const;
  WindowRecord* FindMutable(int window_id);
  const WindowRecord* FindByBrowser(CefRefPtr<CefBrowser> browser) const;
  int WindowIdForBrowser(CefRefPtr<CefBrowser> browser) const;

  /**
   * 解析 Bridge 目标窗口 id。
   * 优先 params.windowId，其次 caller_window_id，最后 focused / 首个窗口（兼容旧行为）。
   */
  int ResolveWindowId(int param_window_id, int caller_window_id) const;

  void SetFocused(int window_id);
  int FocusedWindowId() const { return focused_window_id_; }

  const std::vector<WindowRecord>& All() const { return windows_; }
  bool HasManagedWindow() const;
  /** 主窗口关闭时丢弃尚未挂载的辅助窗 pending，避免孤儿窗口 */
  void RemovePendingByKind(WindowKind kind);

  /** JSON 字符串转义（ListJson 用） */
  static std::string JsonEscape(const std::string& value);

 private:
  WindowRegistry() = default;

  const WindowRecord* ResolveEntry(int window_id) const;
  WindowRecord* ResolveEntry(int window_id);

  std::vector<WindowRecord> windows_;
  std::vector<PendingWindow> pending_;
  int next_id_ = 0;
  int focused_window_id_ = 0;

  WindowRegistry(const WindowRegistry&) = delete;
  WindowRegistry& operator=(const WindowRegistry&) = delete;
};

#endif

}  // namespace niuma
