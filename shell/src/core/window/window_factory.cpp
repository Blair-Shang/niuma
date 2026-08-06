#include "core/window/window_factory.h"

#include "core/window/splash_window.h"
#include "core/window/window_manager.h"
#include "core/window/window_registry.h"
#include "util/win_app_icon.h"

#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_fill_layout.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_helpers.h"

#include <cstdlib>

namespace niuma {

#if NIUMMA_WITH_CEF

namespace {

void ApplyDefaultBrowserSettings(CefBrowserSettings& settings) {
  settings.background_color = 0xFF181818u;
  settings.javascript_access_clipboard = STATE_ENABLED;
  settings.javascript_dom_paste = STATE_ENABLED;
}

struct WindowChromeOptions {
  bool resizable = true;
  bool maximizable = true;
  bool minimizable = true;
  bool maximized = false;
  bool frameless = true;
  bool closable = true;
  int min_width = 400;
  int min_height = 300;
};

WindowChromeOptions ToChromeOptions(const WindowCreateOptions& opts) {
  WindowChromeOptions chrome;
  chrome.resizable = opts.resizable;
  chrome.maximizable = opts.maximizable;
  chrome.minimizable = opts.minimizable;
  chrome.maximized = opts.maximized;
  chrome.frameless = opts.frameless;
  chrome.closable = opts.closable;
  chrome.min_width = opts.min_width > 0 ? opts.min_width : 400;
  chrome.min_height = opts.min_height > 0 ? opts.min_height : 300;
  return chrome;
}

class NiuMaWindowDelegate : public CefWindowDelegate {
 public:
  NiuMaWindowDelegate(CefRefPtr<CefBrowserView> browser_view,
                      cef_runtime_style_t runtime_style,
                      const CefSize& size,
                      const std::string& title,
                      const WindowChromeOptions& chrome)
      : browser_view_(browser_view),
        runtime_style_(runtime_style),
        size_(size),
        title_(title),
        chrome_(chrome) {}

  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    window->SetToFillLayout();
    window->AddChildView(browser_view_);
    if (!title_.empty()) {
      window->SetTitle(title_);
    }
    window->CenterWindow(size_);
#if defined(OS_WIN)
    ApplyAppIconToWindow(window->GetWindowHandle());
#endif
    // 有意不在此处 Show()：保持窗口隐藏，待网页首帧就绪后由
    // NiuMaClient 调用 window->Show() 显示，彻底消除启动白/黑屏闪烁。
  }

  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override {
    (void)window;
    browser_view_ = nullptr;
  }

  bool CanClose(CefRefPtr<CefWindow> window) override {
    (void)window;
    CefRefPtr<CefBrowser> browser = browser_view_ ? browser_view_->GetBrowser()
                                                 : nullptr;
    // closable=false（Splash）：拒绝用户关闭；仅 SplashWindow::Close 置位后放行。
    // Views/Alloy 下 CloseBrowser(true) 仍会走到本回调，返回 false 会永久卡住窗口。
    if (!chrome_.closable && !SplashWindow::Instance().AllowShellClose()) {
      return false;
    }
    if (browser) {
      return browser->GetHost()->TryCloseBrowser();
    }
    return true;
  }

  bool IsFrameless(CefRefPtr<CefWindow> window) override {
    (void)window;
    return chrome_.frameless;
  }

  bool CanResize(CefRefPtr<CefWindow> window) override {
    (void)window;
    return chrome_.resizable;
  }

  bool CanMaximize(CefRefPtr<CefWindow> window) override {
    (void)window;
    return chrome_.resizable && chrome_.maximizable;
  }

  bool CanMinimize(CefRefPtr<CefWindow> window) override {
    (void)window;
    return chrome_.minimizable;
  }

  CefSize GetPreferredSize(CefRefPtr<CefView> view) override {
    (void)view;
    return size_;
  }

  CefSize GetMinimumSize(CefRefPtr<CefView> view) override {
    (void)view;
    return CefSize(chrome_.min_width, chrome_.min_height);
  }

  cef_show_state_t GetInitialShowState(CefRefPtr<CefWindow> window) override {
    (void)window;
    return chrome_.maximized ? CEF_SHOW_STATE_MAXIMIZED : CEF_SHOW_STATE_NORMAL;
  }

  cef_runtime_style_t GetWindowRuntimeStyle() override { return runtime_style_; }

 private:
  CefRefPtr<CefBrowserView> browser_view_;
  const cef_runtime_style_t runtime_style_;
  const CefSize size_;
  const std::string title_;
  const WindowChromeOptions chrome_;

  IMPLEMENT_REFCOUNTING(NiuMaWindowDelegate);
};

class NiuMaBrowserViewDelegate : public CefBrowserViewDelegate {
 public:
  NiuMaBrowserViewDelegate(cef_runtime_style_t runtime_style, const CefSize& size,
                           const WindowChromeOptions& chrome)
      : runtime_style_(runtime_style), size_(size), chrome_(chrome) {}

  bool OnPopupBrowserViewCreated(CefRefPtr<CefBrowserView> browser_view,
                                 CefRefPtr<CefBrowserView> popup_browser_view,
                                 bool is_devtools) override {
    (void)browser_view;
    WindowManager::Instance().OnPopupBrowserViewCreated(popup_browser_view, is_devtools);
    return true;
  }

  CefRefPtr<CefBrowserViewDelegate> GetDelegateForPopupBrowserView(
      CefRefPtr<CefBrowserView> browser_view,
      const CefBrowserSettings& settings,
      CefRefPtr<CefClient> client,
      bool is_devtools) override {
    (void)browser_view;
    (void)settings;
    (void)client;
    const cef_runtime_style_t style =
        is_devtools ? CEF_RUNTIME_STYLE_CHROME : runtime_style_;
    return new NiuMaBrowserViewDelegate(style, size_, chrome_);
  }

  cef_runtime_style_t GetBrowserRuntimeStyle() override { return runtime_style_; }

 private:
  const cef_runtime_style_t runtime_style_;
  const CefSize size_;
  const WindowChromeOptions chrome_;

  IMPLEMENT_REFCOUNTING(NiuMaBrowserViewDelegate);
};

}  // namespace

WindowFactory& WindowFactory::Instance() {
  static WindowFactory instance;
  return instance;
}

void WindowFactory::SetClient(CefRefPtr<CefClient> client) {
  client_ = client;
}

std::string WindowFactory::ResolveStartupUrl() const {
  CefRefPtr<CefCommandLine> command_line = CefCommandLine::GetGlobalCommandLine();
  if (command_line) {
    const std::string switch_url = command_line->GetSwitchValue("url");
    if (!switch_url.empty()) {
      return switch_url;
    }
  }
  if (const char* env = std::getenv("NIUMMA_DEV_URL")) {
    if (env[0] != '\0') {
      return env;
    }
  }
  return "app://niuma/index.html";
}

std::string WindowFactory::ResolveSplashUrl() const {
  // 与主窗同源（dev Vite 或 app://），仅把文档换成静态 splash.html
  std::string base = ResolveStartupUrl();
  const auto hash = base.find('#');
  if (hash != std::string::npos) {
    base = base.substr(0, hash);
  }

  static constexpr char kIndex[] = "index.html";
  static constexpr size_t kIndexLen = sizeof(kIndex) - 1;
  if (base.size() >= kIndexLen &&
      base.compare(base.size() - kIndexLen, kIndexLen, kIndex) == 0) {
    return base.substr(0, base.size() - kIndexLen) + "splash.html";
  }
  if (!base.empty() && base.back() == '/') {
    return base + "splash.html";
  }
  return base + "/splash.html";
}

std::string WindowFactory::BuildWindowUrl(const WindowCreateOptions& opts) const {
  if (!opts.url.empty()) {
    return opts.url;
  }

  std::string base = ResolveStartupUrl();
  if (opts.route.empty()) {
    return base;
  }

  std::string route = opts.route;
  if (route.rfind("http://", 0) == 0 || route.rfind("https://", 0) == 0 ||
      route.rfind("app://", 0) == 0) {
    return route;
  }

  if (route[0] != '#') {
    if (route[0] != '/') {
      route.insert(route.begin(), '/');
    }
    route.insert(route.begin(), '#');
  }

  const auto hash = base.find('#');
  if (hash != std::string::npos) {
    base = base.substr(0, hash);
  }
  return base + route;
}

cef_runtime_style_t WindowFactory::RuntimeStyle() const {
  CefRefPtr<CefCommandLine> command_line = CefCommandLine::GetGlobalCommandLine();
  if (command_line && command_line->HasSwitch("use-alloy-style")) {
    return CEF_RUNTIME_STYLE_ALLOY;
  }
  return CEF_RUNTIME_STYLE_DEFAULT;
}

bool WindowFactory::UseViews() const {
  CefRefPtr<CefCommandLine> command_line = CefCommandLine::GetGlobalCommandLine();
  return !command_line || !command_line->HasSwitch("use-native");
}

void WindowFactory::CreateBrowserWindow(WindowKind kind, const WindowCreateOptions& opts,
                                        int window_id) {
  CEF_REQUIRE_UI_THREAD();
  if (!client_) {
    return;
  }

  const std::string url = BuildWindowUrl(opts);
  const CefSize size(opts.width > 0 ? opts.width : 1280,
                     opts.height > 0 ? opts.height : 800);
  const cef_runtime_style_t runtime_style = RuntimeStyle();
  const WindowChromeOptions chrome = ToChromeOptions(opts);
  CefBrowserSettings browser_settings;
  ApplyDefaultBrowserSettings(browser_settings);

  PendingWindow pending;
  pending.id = window_id;
  pending.kind = kind;
  pending.title = opts.title;
  pending.url = url;
  pending.chrome = opts;
  WindowRegistry::Instance().EnqueuePending(std::move(pending));

  if (UseViews()) {
    CefRefPtr<CefBrowserView> browser_view = CefBrowserView::CreateBrowserView(
        client_, url, browser_settings, nullptr, nullptr,
        new NiuMaBrowserViewDelegate(runtime_style, size, chrome));
    CefWindow::CreateTopLevelWindow(new NiuMaWindowDelegate(
        browser_view, runtime_style, size, opts.title, chrome));
    return;
  }

  CefWindowInfo window_info;
#if defined(OS_WIN)
  const std::wstring title =
      opts.title.empty() ? L"NiuMa" : std::wstring(opts.title.begin(), opts.title.end());
  window_info.SetAsPopup(nullptr, title.c_str());
  window_info.bounds = {0, 0, size.width, size.height};
#endif
  window_info.runtime_style = runtime_style;
  CefBrowserHost::CreateBrowser(window_info, client_.get(), url, browser_settings, nullptr,
                                nullptr);
}

int WindowFactory::Create(WindowKind kind, const WindowCreateOptions& opts) {
  CEF_REQUIRE_UI_THREAD();
  const int window_id = WindowRegistry::Instance().AllocateId();
  CreateBrowserWindow(kind, opts, window_id);
  return window_id;
}

void WindowFactory::CreatePopupShell(CefRefPtr<CefBrowserView> popup_browser_view,
                                     bool is_devtools) {
  CEF_REQUIRE_UI_THREAD();
  const int window_id = WindowRegistry::Instance().AllocateId();
  const cef_runtime_style_t runtime_style =
      is_devtools ? CEF_RUNTIME_STYLE_CHROME : RuntimeStyle();
  const CefSize size(1280, 800);
  WindowChromeOptions chrome;
  chrome.frameless = false;

  PendingWindow pending;
  pending.id = window_id;
  pending.kind = WindowKind::Popup;
  pending.title = is_devtools ? "DevTools" : "";
  pending.url = "";
  pending.chrome = WindowCreateOptions{};
  WindowRegistry::Instance().EnqueuePending(std::move(pending));

  CefWindow::CreateTopLevelWindow(new NiuMaWindowDelegate(
      popup_browser_view, runtime_style, size, is_devtools ? "DevTools" : "", chrome));
}

#endif

}  // namespace niuma
