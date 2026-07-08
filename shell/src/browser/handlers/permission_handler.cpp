#include "browser/handlers/permission_handler.h"

#if NIUMMA_WITH_CEF
#include "include/internal/cef_types.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

namespace {

bool ShouldAutoGrant(uint32_t requested_permissions) {
  constexpr uint32_t kAutoGrant =
      CEF_PERMISSION_TYPE_CLIPBOARD;
  return (requested_permissions & kAutoGrant) != 0;
}

}  // namespace

bool NiuMaPermissionHandler::OnShowPermissionPrompt(
    CefRefPtr<CefBrowser> browser,
    uint64_t prompt_id,
    const CefString& requesting_origin,
    uint32_t requested_permissions,
    CefRefPtr<CefPermissionPromptCallback> callback) {
  (void)browser;
  (void)prompt_id;
  (void)requesting_origin;
  if (!callback || !ShouldAutoGrant(requested_permissions)) {
    return false;
  }
  callback->Continue(CEF_PERMISSION_RESULT_ACCEPT);
  return true;
}

#endif

}  // namespace niuma
