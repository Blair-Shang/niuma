#include "core/window/window_manager.h"

#include "core/window/auxiliary_window.h"
#include "core/window/main_window.h"
#include "core/window/splash_window.h"
#include "core/window/window_factory.h"
#include "core/window/window_registry.h"

#include "include/views/cef_browser_view.h"
#include "include/wrapper/cef_helpers.h"

#if defined(OS_WIN)
#include <windows.h>
#endif

#include <sstream>
#include <unordered_map>

namespace niuma {

#if NIUMMA_WITH_CEF

WindowManager& WindowManager::Instance() {
  static WindowManager instance;
  return instance;
}

void WindowManager::SetClient(CefRefPtr<CefClient> client) {
  WindowFactory::Instance().SetClient(client);
}

/** 按 WindowKind 分发给对应单例管理器（Splash 不进 Auxiliary 复用表） */
void WindowManager::NotifyAttached(const WindowRecord& record) {
  switch (record.kind) {
    case WindowKind::Main:
      MainWindow::Instance().OnAttached(record.id);
      break;
    case WindowKind::Splash:
      SplashWindow::Instance().OnAttached(record.id);
      break;
    case WindowKind::Auxiliary:
      AuxiliaryWindowManager::Instance().OnAttached(record.id);
      break;
    case WindowKind::Popup:
      break;
  }
}

void WindowManager::NotifyDetached(int window_id, WindowKind kind) {
  switch (kind) {
    case WindowKind::Main:
      MainWindow::Instance().OnDetached(window_id);
      break;
    case WindowKind::Splash:
      SplashWindow::Instance().OnDetached(window_id);
      break;
    case WindowKind::Auxiliary:
      AuxiliaryWindowManager::Instance().OnDetached(window_id);
      break;
    case WindowKind::Popup:
      break;
  }
}

CefRefPtr<CefBrowser> WindowManager::FindBrowser(int window_id) const {
  const WindowRecord* entry = WindowRegistry::Instance().Find(window_id);
  return entry ? entry->browser : nullptr;
}

int WindowManager::WindowIdForBrowser(CefRefPtr<CefBrowser> browser) const {
  return WindowRegistry::Instance().WindowIdForBrowser(browser);
}

bool WindowManager::RevealBrowser(CefRefPtr<CefBrowser> browser) {
  const int window_id = WindowIdForBrowser(browser);
  if (window_id <= 0) {
    return false;
  }
  return Reveal(window_id);
}

bool WindowManager::ConcealBrowser(CefRefPtr<CefBrowser> browser) {
  const int window_id = WindowIdForBrowser(browser);
  if (window_id <= 0) {
    return false;
  }
  return Conceal(window_id);
}

CefRefPtr<CefWindow> WindowManager::FindWindow(int window_id) const {
  CefRefPtr<CefBrowser> browser = FindBrowser(window_id);
  if (!browser) {
    return nullptr;
  }
  if (auto browser_view = CefBrowserView::GetForBrowser(browser)) {
    return browser_view->GetWindow();
  }
  return nullptr;
}

std::string WindowManager::ResolveStartupUrl() const {
  return WindowFactory::Instance().ResolveStartupUrl();
}

std::string WindowManager::BuildWindowUrl(const WindowCreateOptions& opts) const {
  return WindowFactory::Instance().BuildWindowUrl(opts);
}

int WindowManager::Open(const WindowCreateOptions& opts) {
  return AuxiliaryWindowManager::Instance().Open(opts);
}

bool WindowManager::Close(int window_id) {
  CEF_REQUIRE_UI_THREAD();
  WindowRecord* entry = WindowRegistry::Instance().FindMutable(window_id);
  if (entry && entry->browser) {
    entry->browser->GetHost()->CloseBrowser(false);
    return true;
  }
  return false;
}

bool WindowManager::Focus(int window_id) {
  CEF_REQUIRE_UI_THREAD();
  WindowRecord* entry = WindowRegistry::Instance().FindMutable(window_id);
  if (!entry || !entry->browser) {
    return false;
  }
  entry->browser->GetHost()->SetFocus(true);
  if (auto window = FindWindow(entry->id)) {
    // 首载 reveal 前窗口应保持隐藏；过早 Show 会导致 CEF 黑/白底闪烁。
    if (entry->user_revealed) {
      window->Show();
      window->Activate();
    }
  }
  WindowRegistry::Instance().SetFocused(entry->id);
  return true;
}

bool WindowManager::Maximize(int window_id) {
  CEF_REQUIRE_UI_THREAD();
  if (auto window = FindWindow(window_id)) {
    window->Maximize();
    return true;
  }
  return false;
}

bool WindowManager::Minimize(int window_id) {
  CEF_REQUIRE_UI_THREAD();
  if (auto window = FindWindow(window_id)) {
    window->Minimize();
    return true;
  }
  return false;
}

bool WindowManager::Restore(int window_id) {
  CEF_REQUIRE_UI_THREAD();
  if (auto window = FindWindow(window_id)) {
    if (window->IsFullscreen()) {
      window->SetFullscreen(false);
    } else if (window->IsMaximized()) {
      window->Restore();
    } else if (window->IsMinimized()) {
      window->Show();
    }
    return true;
  }
  return false;
}

bool WindowManager::SetFullscreen(int window_id, bool fullscreen) {
  CEF_REQUIRE_UI_THREAD();
  if (auto window = FindWindow(window_id)) {
    window->SetFullscreen(fullscreen);
    return true;
  }
  return false;
}

bool WindowManager::Reveal(int window_id) {
  CEF_REQUIRE_UI_THREAD();
  WindowRecord* entry = WindowRegistry::Instance().FindMutable(window_id);
  if (!entry) {
    return false;
  }
  if (auto window = FindWindow(window_id)) {
    entry->user_revealed = true;
    window->Show();
    window->Activate();
    // Web 侧 shell.window.reveal 只走这里，不经 NiuMaClient::RevealBrowserWindow；
    // 主窗首显时必须在此关 Splash，否则小启动窗会一直留在前台。
    if (entry->kind == WindowKind::Main) {
      SplashWindow::Instance().Close();
    }
    return true;
  }
  return false;
}

bool WindowManager::Conceal(int window_id) {
  CEF_REQUIRE_UI_THREAD();
  WindowRecord* entry = WindowRegistry::Instance().FindMutable(window_id);
  if (!entry) {
    return false;
  }
  if (auto window = FindWindow(window_id)) {
    entry->user_revealed = false;
    window->Hide();
    return true;
  }
  return false;
}

bool WindowManager::SetTitle(int window_id, const std::string& title) {
  CEF_REQUIRE_UI_THREAD();
  WindowRecord* entry = WindowRegistry::Instance().FindMutable(window_id);
  if (!entry || !entry->browser) {
    return false;
  }
  WindowRegistry::Instance().UpdateTitle(entry->browser, title);
  if (auto window = FindWindow(window_id)) {
    window->SetTitle(title);
  }
  return true;
}

bool WindowManager::StartResize(int window_id, const std::string& edge) {
#if defined(OS_WIN)
  CEF_REQUIRE_UI_THREAD();
  if (auto window = FindWindow(window_id)) {
    HWND hwnd = window->GetWindowHandle();
    if (!hwnd) {
      return false;
    }

    static const std::unordered_map<std::string, WPARAM> k_edges = {
        {"n", WMSZ_TOP},
        {"s", WMSZ_BOTTOM},
        {"e", WMSZ_RIGHT},
        {"w", WMSZ_LEFT},
        {"ne", WMSZ_TOPRIGHT},
        {"nw", WMSZ_TOPLEFT},
        {"se", WMSZ_BOTTOMRIGHT},
        {"sw", WMSZ_BOTTOMLEFT},
    };
    const auto it = k_edges.find(edge);
    if (it == k_edges.end()) {
      return false;
    }

    ReleaseCapture();
    SendMessage(hwnd, WM_SYSCOMMAND, SC_SIZE | it->second, 0);
    return true;
  }
#else
  (void)window_id;
  (void)edge;
#endif
  return false;
}

std::string WindowManager::StateJson(int window_id) const {
  const WindowRecord* entry = WindowRegistry::Instance().Find(window_id);
  if (!entry) {
    return "{}";
  }
  if (auto window = FindWindow(entry->id)) {
    std::ostringstream ss;
    ss << "{\"id\":" << entry->id << ",\"frameless\":"
       << (entry->chrome.frameless ? "true" : "false")
       << ",\"maximized\":"
       << (window->IsMaximized() ? "true" : "false")
       << ",\"minimized\":" << (window->IsMinimized() ? "true" : "false")
       << ",\"fullscreen\":" << (window->IsFullscreen() ? "true" : "false") << "}";
    return ss.str();
  }
  return "{\"frameless\":" + std::string(entry->chrome.frameless ? "true" : "false") + "}";
}

std::string WindowManager::ListJson() const {
  const auto& windows = WindowRegistry::Instance().All();
  const int focused_id = WindowRegistry::Instance().FocusedWindowId();

  std::ostringstream ss;
  ss << "{\"windows\":[";
  bool first = true;
  for (const auto& entry : windows) {
    if (!first) {
      ss << ',';
    }
    first = false;
    const bool focused = entry.id == focused_id;
    bool maximized = false;
    bool minimized = false;
    bool fullscreen = false;
    if (auto window = FindWindow(entry.id)) {
      maximized = window->IsMaximized();
      minimized = window->IsMinimized();
      fullscreen = window->IsFullscreen();
    }
    ss << "{\"id\":" << entry.id << ",\"title\":\""
       << WindowRegistry::JsonEscape(entry.title) << "\",\"url\":\""
       << WindowRegistry::JsonEscape(entry.url)
       << "\",\"focused\":" << (focused ? "true" : "false")
       << ",\"maximized\":" << (maximized ? "true" : "false")
       << ",\"minimized\":" << (minimized ? "true" : "false")
       << ",\"fullscreen\":" << (fullscreen ? "true" : "false") << "}";
  }
  ss << "]}";
  return ss.str();
}

void WindowManager::AttachBrowser(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  WindowRecord attached;
  if (!WindowRegistry::Instance().AttachBrowser(browser, &attached)) {
    return;
  }
  NotifyAttached(attached);
}

void WindowManager::DetachBrowser(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  const WindowRecord* entry = WindowRegistry::Instance().FindByBrowser(browser);
  if (!entry) {
    return;
  }
  const int window_id = entry->id;
  const WindowKind kind = entry->kind;
  WindowRegistry::Instance().RemoveByBrowser(browser);
  NotifyDetached(window_id, kind);
}

void WindowManager::UpdateTitle(CefRefPtr<CefBrowser> browser, const std::string& title) {
  WindowRegistry::Instance().UpdateTitle(browser, title);
}

void WindowManager::OnPopupBrowserViewCreated(CefRefPtr<CefBrowserView> popup_browser_view,
                                              bool is_devtools) {
  WindowFactory::Instance().CreatePopupShell(popup_browser_view, is_devtools);
}

bool WindowManager::HasManagedWindow() const {
  return WindowRegistry::Instance().HasManagedWindow();
}

#endif

}  // namespace niuma
