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
      const std::string trace =
          resp.trace_id.empty() ? resp.id : resp.trace_id;
      callback->Failure(0, niuma::FormatBridgeFailureJson(
                               resp.error, resp.error_code, trace));
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
  if (!frame) return;
  // 必须用 JSON.parse(字符串) 注入：不能把 event.data 当 JS 对象字面量拼接。
  // Windows 路径等若转义不完整（如 "E:\DATAHUB"），直接嵌入会触发
  // Uncaught SyntaxError: Invalid or unexpected token，DevTools 显示为 (index):1。
  const std::string& data = event.data;
  if (data.empty() || (data[0] != '{' && data[0] != '[')) {
    return;
  }
  const std::string js =
      "try{window.dispatchEvent(new CustomEvent('niuma:event',{detail:JSON.parse(" +
      niuma::JsonQuoteString(data) +
      ")}));}catch(e){console.error('[niuma] bridge event',e);}";
  // 使用独立 script URL，避免解析错误被归到页面 (index):1
  frame->ExecuteJavaScript(js, "niuma://bridge-event", 1);
}

void NiuMaMessageRouterHandler::CancelAllPending() {}

#endif
