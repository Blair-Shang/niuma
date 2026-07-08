#include "core/cef/niuma_render_process_handler.h"

namespace niuma {

#if NIUMMA_WITH_CEF

NiuMaRenderProcessHandler::NiuMaRenderProcessHandler() = default;

void NiuMaRenderProcessHandler::OnWebKitInitialized() {
  CefMessageRouterConfig config;
  config.js_query_function = "cefQuery";
  config.js_cancel_function = "cefQueryCancel";
  render_router_ = CefMessageRouterRendererSide::Create(config);
}

void NiuMaRenderProcessHandler::OnContextCreated(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefRefPtr<CefV8Context> context) {
  if (render_router_) {
    render_router_->OnContextCreated(browser, frame, context);
  }
}

void NiuMaRenderProcessHandler::OnContextReleased(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefRefPtr<CefV8Context> context) {
  if (render_router_) {
    render_router_->OnContextReleased(browser, frame, context);
  }
}

bool NiuMaRenderProcessHandler::OnProcessMessageReceived(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefProcessId source_process,
    CefRefPtr<CefProcessMessage> message) {
  if (!render_router_) {
    return false;
  }
  return render_router_->OnProcessMessageReceived(browser, frame, source_process,
                                                 message);
}

#endif

}  // namespace niuma
