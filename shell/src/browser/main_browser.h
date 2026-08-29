#pragma once

#if NIUMMA_WITH_CEF
#include "browser/handlers/message_router_handler.h"
#include "browser/handlers/context_menu_handler.h"
#include "browser/handlers/drag_handler.h"
#include "browser/handlers/download_handler.h"
#include "browser/handlers/permission_handler.h"
#include "ipc/platform_client.h"
#include "include/cef_client.h"
#include "include/cef_context_menu_handler.h"
#include "include/cef_display_handler.h"
#include "include/cef_dialog_handler.h"
#include "include/cef_download_handler.h"
#include "include/cef_drag_handler.h"
#include "include/cef_jsdialog_handler.h"
#include "include/cef_keyboard_handler.h"
#include "include/cef_life_span_handler.h"
#include "include/cef_load_handler.h"
#include <list>
#include "include/wrapper/cef_message_router.h"

#include <memory>
#include <set>
#endif

namespace niuma {

#if NIUMMA_WITH_CEF
/** 主工作台 Browser 实例：CEF 回调与 ① cefQuery 绑定，不含业务逻辑。 */
class NiuMaClient : public CefClient,
                    public CefDisplayHandler,
                    public CefDialogHandler,
                    public CefDragHandler,
                    public CefJSDialogHandler,
                    public CefKeyboardHandler,
                    public CefLifeSpanHandler,
                    public CefLoadHandler {
 public:
  NiuMaClient();

  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefDialogHandler> GetDialogHandler() override { return this; }
  CefRefPtr<CefContextMenuHandler> GetContextMenuHandler() override {
    return context_menu_handler_;
  }
  CefRefPtr<CefDragHandler> GetDragHandler() override { return drag_handler_; }
  CefRefPtr<CefPermissionHandler> GetPermissionHandler() override {
    return permission_handler_;
  }
  CefRefPtr<CefDownloadHandler> GetDownloadHandler() override {
    return download_handler_;
  }
  CefRefPtr<CefJSDialogHandler> GetJSDialogHandler() override { return this; }
  CefRefPtr<CefKeyboardHandler> GetKeyboardHandler() override { return this; }
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }

  bool DoClose(CefRefPtr<CefBrowser> browser) override;

  void OnTitleChange(CefRefPtr<CefBrowser> browser,
                     const CefString& title) override;

  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser,
                                CefRefPtr<CefFrame> frame,
                                CefProcessId source_process,
                                CefRefPtr<CefProcessMessage> message) override;

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  void OnLoadStart(CefRefPtr<CefBrowser> browser,
                   CefRefPtr<CefFrame> frame,
                   TransitionType transition_type) override;
  void OnLoadEnd(CefRefPtr<CefBrowser> browser,
                 CefRefPtr<CefFrame> frame,
                 int httpStatusCode) override;
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

  bool OnPreKeyEvent(CefRefPtr<CefBrowser> browser,
                     const CefKeyEvent& event,
                     CefEventHandle os_event,
                     bool* is_keyboard_shortcut) override;

  CefRefPtr<CefBrowser> GetBrowser() const { return browser_; }

 private:
  using BrowserList = std::list<CefRefPtr<CefBrowser>>;

  /** 网页首帧就绪后显示对应窗口，幂等：同一 browser 只显示一次，避免与
   *  用户最小化等操作竞争。 */
  void RevealBrowserWindow(CefRefPtr<CefBrowser> browser);

  CefRefPtr<CefBrowser> browser_;
  BrowserList browsers_;
  bool is_closing_ = false;
  CefRefPtr<CefMessageRouterBrowserSide> browser_router_;
  std::unique_ptr<NiuMaMessageRouterHandler> message_router_handler_;
  CefRefPtr<NiuMaContextMenuHandler> context_menu_handler_;
  CefRefPtr<NiuMaDragHandler> drag_handler_;
  CefRefPtr<NiuMaPermissionHandler> permission_handler_;
  CefRefPtr<NiuMaDownloadHandler> download_handler_;
  std::set<int> revealed_browsers_;
  bool event_listener_started_ = false;

  IMPLEMENT_REFCOUNTING(NiuMaClient);
};
#endif

}  // namespace niuma
