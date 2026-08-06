#include "core/window/splash_window.h"

#include "core/window/window_factory.h"
#include "core/window/window_registry.h"

#include "include/cef_browser.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_helpers.h"

namespace niuma {

#if NIUMMA_WITH_CEF

namespace {

/** 按 id 精确查找；找不到再扫 Splash kind，避免 id 不同步时关不掉 */
CefRefPtr<CefBrowser> FindSplashBrowser(int window_id) {
  if (window_id > 0) {
    const WindowRecord* exact = WindowRegistry::Instance().FindExact(window_id);
    if (exact && exact->kind == WindowKind::Splash && exact->browser) {
      return exact->browser;
    }
  }
  for (const auto& entry : WindowRegistry::Instance().All()) {
    if (entry.kind == WindowKind::Splash && entry.browser) {
      return entry.browser;
    }
  }
  return nullptr;
}

}  // namespace

SplashWindow& SplashWindow::Instance() {
  static SplashWindow instance;
  return instance;
}

void SplashWindow::Create(CefRefPtr<CefClient> client) {
  CEF_REQUIRE_UI_THREAD();
  WindowFactory::Instance().SetClient(client);
  if (HasSplash()) {
    return;
  }

  // 小窗、不可缩放/最小化；无边框；禁止用户关闭（Shell Close 经 AllowShellClose 放行）
  WindowCreateOptions opts;
  opts.url = WindowFactory::Instance().ResolveSplashUrl();
  opts.title = "NiuMa";
  opts.width = 420;
  opts.height = 280;
  opts.min_width = 420;
  opts.min_height = 280;
  opts.resizable = false;
  opts.maximizable = false;
  opts.minimizable = false;
  opts.frameless = true;
  opts.closable = false;

  window_id_ = WindowFactory::Instance().Create(WindowKind::Splash, opts);
  closing_ = false;
}

void SplashWindow::Close() {
  CEF_REQUIRE_UI_THREAD();

  // 先置位，使随后 CefWindow::Close → CanClose 能放行（Views 下 CloseBrowser(true) 不够）
  closing_ = true;

  CefRefPtr<CefBrowser> browser = FindSplashBrowser(window_id_);
  if (!browser) {
    WindowRegistry::Instance().RemovePendingByKind(WindowKind::Splash);
    window_id_ = 0;
    closing_ = false;
    return;
  }

  if (auto browser_view = CefBrowserView::GetForBrowser(browser)) {
    if (auto window = browser_view->GetWindow()) {
      // 立刻从屏幕消失，避免主窗已显而 Splash 仍挡在前面
      window->Hide();
      // 走 Views 正常关闭：CanClose 见 AllowShellClose()==true → TryCloseBrowser
      window->Close();
      return;
    }
  }

  // 非 Views 回退
  browser->GetHost()->CloseBrowser(false);
}

bool SplashWindow::IsSplash(int window_id) const {
  return window_id_ > 0 && window_id == window_id_;
}

void SplashWindow::OnAttached(int window_id) {
  if (window_id_ <= 0) {
    window_id_ = window_id;
  }
}

void SplashWindow::OnDetached(int window_id) {
  if (window_id_ == window_id) {
    window_id_ = 0;
    closing_ = false;
  }
}

#endif

}  // namespace niuma
