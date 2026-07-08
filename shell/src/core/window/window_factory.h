#pragma once

#include "core/window/window_types.h"

#if NIUMMA_WITH_CEF
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

/**
 * CEF 顶层窗口创建（Delegate + BrowserView / 原生窗口）。
 * 创建前向 WindowRegistry 入队 PendingWindow，Browser 就绪后由 WindowManager 挂载。
 */
class WindowFactory {
 public:
  static WindowFactory& Instance();

  void SetClient(CefRefPtr<CefClient> client);
  CefRefPtr<CefClient> Client() const { return client_; }

  /** 分配 id、入队 pending，并发起 CreateBrowserView / CreateBrowser */
  int Create(WindowKind kind, const WindowCreateOptions& opts);

  /** DevTools / window.open 弹出的次级 CEF 窗口 */
  void CreatePopupShell(CefRefPtr<CefBrowserView> popup_browser_view, bool is_devtools);

  std::string ResolveStartupUrl() const;
  std::string BuildWindowUrl(const WindowCreateOptions& opts) const;

 private:
  WindowFactory() = default;

  void CreateBrowserWindow(WindowKind kind, const WindowCreateOptions& opts, int window_id);
  cef_runtime_style_t RuntimeStyle() const;
  bool UseViews() const;

  CefRefPtr<CefClient> client_;

  WindowFactory(const WindowFactory&) = delete;
  WindowFactory& operator=(const WindowFactory&) = delete;
};

#endif

}  // namespace niuma
