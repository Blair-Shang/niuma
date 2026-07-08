#pragma once

#if NIUMMA_WITH_CEF
#include "include/cef_app.h"
#include "include/wrapper/cef_message_router.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF
class NiuMaRenderProcessHandler : public CefRenderProcessHandler {
 public:
  NiuMaRenderProcessHandler();

  void OnWebKitInitialized() override;
  void OnContextCreated(CefRefPtr<CefBrowser> browser,
                        CefRefPtr<CefFrame> frame,
                        CefRefPtr<CefV8Context> context) override;
  void OnContextReleased(CefRefPtr<CefBrowser> browser,
                         CefRefPtr<CefFrame> frame,
                         CefRefPtr<CefV8Context> context) override;
  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser,
                                CefRefPtr<CefFrame> frame,
                                CefProcessId source_process,
                                CefRefPtr<CefProcessMessage> message) override;

 private:
  CefRefPtr<CefMessageRouterRendererSide> render_router_;

  IMPLEMENT_REFCOUNTING(NiuMaRenderProcessHandler);
};
#endif

}  // namespace niuma
