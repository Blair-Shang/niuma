#include "browser/main_browser.h"
#include "ipc/platform_client.h"
#include "browser/handlers/drag_handler.h"
#include "core/window/main_window.h"
#include "core/window/window_manager.h"
#include "core/window/window_registry.h"
#include "util/json_util.h"

#if NIUMMA_WITH_CEF
#include "include/cef_app.h"
#include "include/base/cef_callback.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"

#include "util/win_app_icon.h"

#include <sstream>
#endif

namespace {

bool IsDevToolsBrowser(CefRefPtr<CefBrowser> browser) {
  if (!browser) {
    return false;
  }
  CefRefPtr<CefFrame> frame = browser->GetMainFrame();
  if (!frame) {
    return false;
  }
  const std::string url = frame->GetURL().ToString();
  return url.rfind("devtools://", 0) == 0;
}

void ToggleDevTools(CefRefPtr<CefBrowser> browser) {
  if (!browser) {
    return;
  }
  CefRefPtr<CefBrowserHost> host = browser->GetHost();
  if (!host) {
    return;
  }
  if (host->HasDevTools()) {
    host->CloseDevTools();
    return;
  }
  CefWindowInfo window_info;
  // Alloy 主窗口下 DevTools 弹窗必须使用 Chrome runtime style，否则 CEF 崩溃。
  window_info.runtime_style = CEF_RUNTIME_STYLE_CHROME;
  CefBrowserSettings settings;
  settings.javascript_access_clipboard = STATE_ENABLED;
  settings.javascript_dom_paste = STATE_ENABLED;
  host->ShowDevTools(window_info, nullptr, settings, CefPoint());
}

bool IsDevToolsShortcut(const CefKeyEvent& event) {
  if (event.type != KEYEVENT_RAWKEYDOWN && event.type != KEYEVENT_KEYDOWN) {
    return false;
  }
#if defined(OS_WIN)
  if (event.windows_key_code == VK_F12) {
    return true;
  }
  const bool ctrl = (event.modifiers & EVENTFLAG_CONTROL_DOWN) != 0;
  const bool shift = (event.modifiers & EVENTFLAG_SHIFT_DOWN) != 0;
  if (ctrl && shift && event.windows_key_code == 'I') {
    return true;
  }
#endif
  return false;
}

}  // namespace

namespace niuma {

#if NIUMMA_WITH_CEF

NiuMaClient::NiuMaClient() {
  drag_handler_ = new NiuMaDragHandler();
  permission_handler_ = new NiuMaPermissionHandler();
  message_router_handler_ = std::make_unique<NiuMaMessageRouterHandler>();
  CefMessageRouterConfig config;
  config.js_query_function = "cefQuery";
  config.js_cancel_function = "cefQueryCancel";
  browser_router_ = CefMessageRouterBrowserSide::Create(config);
  browser_router_->AddHandler(message_router_handler_.get(), false);
}

bool NiuMaClient::OnProcessMessageReceived(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefProcessId source_process,
    CefRefPtr<CefProcessMessage> message) {
  return browser_router_->OnProcessMessageReceived(browser, frame, source_process,
                                                   message);
}

void NiuMaClient::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  if (!IsDevToolsBrowser(browser)) {
    WindowManager::Instance().AttachBrowser(browser);
#if defined(OS_WIN)
    HWND icon_target = nullptr;
    if (auto browser_view = CefBrowserView::GetForBrowser(browser)) {
      if (auto window = browser_view->GetWindow()) {
        icon_target = window->GetWindowHandle();
      }
    }
    if (!icon_target) {
      icon_target = browser->GetHost()->GetWindowHandle();
    }
    ApplyAppIconToWindow(icon_target);
#endif
    if (!event_listener_started_) {
      event_listener_started_ = true;
      NiuMaMessageRouterHandler* handler = message_router_handler_.get();
      auto dispatch_platform_event = [this, handler](const std::string& json) {
        if (!handler) {
          return;
        }
        niuma::BridgeEvent ev;
        ev.type = niuma::JsonGetString(json, "type");
        ev.data = json;
        for (const auto& entry : browsers_) {
          if (entry && !IsDevToolsBrowser(entry)) {
            handler->PushEvent(entry, ev);
          }
        }
      };
      PlatformClient::SetStreamFrameCallback(dispatch_platform_event);
      PlatformClient::StartEventListener(dispatch_platform_event);
    }
    // 兜底：主窗口在 Web reveal 失败时 3 秒后强制显示。
    const WindowRecord* entry = WindowRegistry::Instance().FindByBrowser(browser);
    if (!entry || entry->kind != WindowKind::Auxiliary) {
      CefPostDelayedTask(
          TID_UI,
          base::BindOnce(&NiuMaClient::RevealBrowserWindow,
                         CefRefPtr<NiuMaClient>(this), browser),
          3000);
    }
  }
  browser_ = browser;
  browsers_.push_back(browser);
}

void NiuMaClient::RevealBrowserWindow(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  if (!browser || IsDevToolsBrowser(browser)) {
    return;
  }
  const int id = browser->GetIdentifier();
  if (revealed_browsers_.count(id) != 0) {
    return;
  }
  if (WindowManager::Instance().RevealBrowser(browser)) {
    revealed_browsers_.insert(id);
#if defined(OS_WIN)
    if (auto browser_view = CefBrowserView::GetForBrowser(browser)) {
      if (auto window = browser_view->GetWindow()) {
        ApplyAppIconToWindow(window->GetWindowHandle());
      }
    }
#endif
  }
}

void NiuMaClient::OnTitleChange(CefRefPtr<CefBrowser> browser,
                                const CefString& title) {
  CEF_REQUIRE_UI_THREAD();
  const std::string title_str = title.ToString();
  WindowManager::Instance().UpdateTitle(browser, title_str);
  if (auto browser_view = CefBrowserView::GetForBrowser(browser)) {
    if (auto window = browser_view->GetWindow()) {
      window->SetTitle(title);
    }
  }
}

bool NiuMaClient::DoClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  if (IsDevToolsBrowser(browser)) {
    return false;
  }
  if (MainWindow::Instance().IsMainBrowser(browser)) {
    is_closing_ = true;
    MainWindow::Instance().OnClosing();
  }
  return false;
}

void NiuMaClient::OnLoadStart(CefRefPtr<CefBrowser> browser,
                              CefRefPtr<CefFrame> frame,
                              TransitionType transition_type) {
  (void)transition_type;
  if (!browser || !frame->IsMain() || IsDevToolsBrowser(browser)) {
    return;
  }
  const WindowRecord* entry = WindowRegistry::Instance().FindByBrowser(browser);
  const int browser_id = browser->GetIdentifier();
  // 辅助窗：index.html 起显 + 内联启动动画，不等待 Vite/Vue bundle
  if (entry && entry->kind == WindowKind::Auxiliary) {
    if (revealed_browsers_.count(browser_id) == 0) {
      RevealBrowserWindow(browser);
    }
    return;
  }
  // 首载尚未 reveal 时窗口本就隐藏，跳过 Conceal，避免与 reveal 竞态产生黑屏一闪。
  if (revealed_browsers_.count(browser_id) == 0) {
    return;
  }
  // 热重载 / 页面导航：已显示窗口先隐藏，待 Web reveal 后再显示。
  revealed_browsers_.erase(browser_id);
  WindowManager::Instance().ConcealBrowser(browser);
}

void NiuMaClient::OnLoadEnd(CefRefPtr<CefBrowser> browser,
                            CefRefPtr<CefFrame> frame,
                            int httpStatusCode) {
  (void)httpStatusCode;
  if (!browser || !frame->IsMain() || IsDevToolsBrowser(browser)) {
    return;
  }
  frame->ExecuteJavaScript(
      R"(window.niuma = window.niuma || { ready: true, mode: 'cef' };)",
      frame->GetURL(), 0);
  NiuMaDragHandler::InstallFileDropHooks(frame);

  // 窗口显示由 Web 侧在 Vue mount() + nextTick 后调用 shell.window.reveal 触发，
  // 确保 Vue 首帧已渲染完毕再显示，彻底消除启动黑屏闪烁。
  // OnAfterCreated 的 3 秒兜底只在首次创建浏览器时注册；热重载会 Conceal 窗口，
  // 此处每次主帧加载结束都重新注册兜底，避免 Vite 全量刷新后窗口一直隐藏。
  const WindowRecord* entry = WindowRegistry::Instance().FindByBrowser(browser);
  if (!entry || entry->kind != WindowKind::Auxiliary) {
    CefPostDelayedTask(
        TID_UI,
        base::BindOnce(&NiuMaClient::RevealBrowserWindow,
                       CefRefPtr<NiuMaClient>(this), browser),
        3000);
  }
}

bool NiuMaClient::OnPreKeyEvent(CefRefPtr<CefBrowser> browser,
                                const CefKeyEvent& event,
                                CefEventHandle os_event,
                                bool* is_keyboard_shortcut) {
  (void)os_event;
  (void)is_keyboard_shortcut;
  if (IsDevToolsShortcut(event)) {
    ToggleDevTools(browser);
    return true;
  }
  return false;
}

void NiuMaClient::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  if (browser_router_) {
    browser_router_->OnBeforeClose(browser);
  }

  const int window_id = WindowManager::Instance().WindowIdForBrowser(browser);
  const WindowRecord* closing_entry = WindowRegistry::Instance().FindByBrowser(browser);
  const WindowKind closing_kind =
      closing_entry ? closing_entry->kind : WindowKind::Popup;

  if (!IsDevToolsBrowser(browser)) {
    WindowManager::Instance().DetachBrowser(browser);

    if (window_id > 0 && closing_kind != WindowKind::Popup && message_router_handler_) {
      std::ostringstream ss;
      ss << "{\"type\":\"shell.window.closed\",\"windowId\":" << window_id << "}";
      niuma::BridgeEvent ev;
      ev.type = "shell.window.closed";
      ev.data = ss.str();
      for (const auto& entry : browsers_) {
        if (entry && !IsDevToolsBrowser(entry) && !entry->IsSame(browser)) {
          message_router_handler_->PushEvent(entry, ev);
        }
      }
    }
  }
  revealed_browsers_.erase(browser->GetIdentifier());

  for (auto it = browsers_.begin(); it != browsers_.end(); ++it) {
    if ((*it)->IsSame(browser)) {
      browsers_.erase(it);
      break;
    }
  }
  if (browser_ && browser_->IsSame(browser)) {
    browser_ = browsers_.empty() ? nullptr : browsers_.back();
  }

  if (!WindowManager::Instance().HasManagedWindow()) {
    PlatformClient::CloseAllStreams();
    PlatformClient::StopEventListener();
    if (browser_router_ && message_router_handler_) {
      browser_router_->RemoveHandler(message_router_handler_.get());
    }
    if (message_router_handler_) {
      message_router_handler_->CancelAllPending();
      message_router_handler_.reset();
    }
    PlatformClient::CloseAllStreams();
    CefQuitMessageLoop();
  }
}

#endif

}  // namespace niuma
