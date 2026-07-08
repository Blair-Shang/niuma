#pragma once

#include "core/window/window_types.h"

#include <string>

#if NIUMMA_WITH_CEF
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

/**
 * 窗口门面：对外保持统一 API（Bridge / main_browser 无需感知 Main / Auxiliary 拆分）。
 *
 * 实现委托：
 * - 创建 → MainWindow / AuxiliaryWindowManager + WindowFactory
 * - 登记 / 查找 → WindowRegistry
 * - 显示控制（Show/Hide/Maximize 等）→ 本类 + Registry
 */
class WindowManager {
 public:
  static WindowManager& Instance();

  void SetClient(CefRefPtr<CefClient> client);

  /** 打开辅助窗口（shell.window.open）；主窗口请用 MainWindow::Create */
  int Open(const WindowCreateOptions& opts);
  bool Close(int window_id);
  bool Focus(int window_id);
  bool Maximize(int window_id);
  bool Minimize(int window_id);
  bool Restore(int window_id);
  bool SetFullscreen(int window_id, bool fullscreen);
  bool Reveal(int window_id);
  bool Conceal(int window_id);
  bool SetTitle(int window_id, const std::string& title);
  bool StartResize(int window_id, const std::string& edge);
  std::string ListJson() const;
  std::string StateJson(int window_id) const;

  CefRefPtr<CefBrowser> FindBrowser(int window_id) const;
  CefRefPtr<CefWindow> FindWindow(int window_id) const;
  int WindowIdForBrowser(CefRefPtr<CefBrowser> browser) const;
  bool RevealBrowser(CefRefPtr<CefBrowser> browser);
  bool ConcealBrowser(CefRefPtr<CefBrowser> browser);

  void AttachBrowser(CefRefPtr<CefBrowser> browser);
  void DetachBrowser(CefRefPtr<CefBrowser> browser);
  void UpdateTitle(CefRefPtr<CefBrowser> browser, const std::string& title);
  void OnPopupBrowserViewCreated(CefRefPtr<CefBrowserView> popup_browser_view,
                                 bool is_devtools = false);
  bool HasManagedWindow() const;

  std::string ResolveStartupUrl() const;
  std::string BuildWindowUrl(const WindowCreateOptions& opts) const;

 private:
  WindowManager() = default;

  void NotifyAttached(const struct WindowRecord& record);
  void NotifyDetached(int window_id, WindowKind kind);

  WindowManager(const WindowManager&) = delete;
  WindowManager& operator=(const WindowManager&) = delete;
};

#endif

}  // namespace niuma
