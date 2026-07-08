#pragma once

#if NIUMMA_WITH_CEF
#include "include/cef_browser.h"
#include "include/cef_permission_handler.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

/** 桌面壳层自动放行剪贴板等权限，避免 Alloy 默认 IGNORE 导致 navigator.clipboard 失败。 */
class NiuMaPermissionHandler : public CefPermissionHandler {
 public:
  bool OnShowPermissionPrompt(
      CefRefPtr<CefBrowser> browser,
      uint64_t prompt_id,
      const CefString& requesting_origin,
      uint32_t requested_permissions,
      CefRefPtr<CefPermissionPromptCallback> callback) override;

 private:
  IMPLEMENT_REFCOUNTING(NiuMaPermissionHandler);
};

#endif

}  // namespace niuma
