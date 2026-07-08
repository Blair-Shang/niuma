#include "browser/handlers/message_router_handler.h"
#include "core/window/window_manager.h"
#include "util/json_util.h"

#if NIUMMA_WITH_CEF

NiuMaMessageRouterHandler::NiuMaMessageRouterHandler() = default;
NiuMaMessageRouterHandler::~NiuMaMessageRouterHandler() = default;

bool NiuMaMessageRouterHandler::OnQuery(CefRefPtr<CefBrowser> browser,
                                        CefRefPtr<CefFrame> frame,
                                        int64_t query_id,
                                        const CefString& request,
                                        bool persistent,
                                        CefRefPtr<Callback> callback) {
  (void)frame;
  (void)query_id;
  (void)persistent;

  const std::string raw = request.ToString();
  niuma::BridgeRequest req;
  req.params = raw;
  req.method = niuma::JsonGetString(raw, "method");
  req.id = niuma::JsonGetString(raw, "id");
  req.caller_window_id = niuma::WindowManager::Instance().WindowIdForBrowser(browser);
  if (req.id.empty()) {
    req.id = "0";
  }
  if (req.method.empty()) {
    req.method = "ping";
  }

  router_.Dispatch(req, [callback](niuma::BridgeResponse resp) {
    if (resp.ok) {
      callback->Success(resp.result.empty() ? "{}" : resp.result);
    } else {
      callback->Failure(0, resp.error);
    }
  });
  return true;
}

void NiuMaMessageRouterHandler::OnQueryCanceled(CefRefPtr<CefBrowser> browser,
                                                CefRefPtr<CefFrame> frame,
                                                int64_t query_id) {
  (void)browser;
  (void)frame;
  (void)query_id;
}

void NiuMaMessageRouterHandler::PushEvent(CefRefPtr<CefBrowser> browser,
                                          const niuma::BridgeEvent& event) {
  if (!browser) return;
  auto frame = browser->GetMainFrame();
  const std::string js =
      "window.dispatchEvent(new CustomEvent('niuma:event',{detail:" +
      event.data + "}));";
  frame->ExecuteJavaScript(js, frame->GetURL(), 0);
}

void NiuMaMessageRouterHandler::CancelAllPending() {}

#endif
