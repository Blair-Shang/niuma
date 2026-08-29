#include "browser/handlers/download_handler.h"

#if NIUMMA_WITH_CEF

namespace niuma {

namespace {

bool IsAllowedDownloadUrl(const std::string& url) {
  return url.rfind("https://", 0) == 0 || url.rfind("http://", 0) == 0 ||
         url.rfind("blob:", 0) == 0;
}

}  // namespace

bool NiuMaDownloadHandler::CanDownload(CefRefPtr<CefBrowser> browser,
                                       const CefString& url,
                                       const CefString& request_method) {
  (void)browser;
  (void)request_method;
  return IsAllowedDownloadUrl(url.ToString());
}

bool NiuMaDownloadHandler::OnBeforeDownload(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefDownloadItem> download_item,
    const CefString& suggested_name,
    CefRefPtr<CefBeforeDownloadCallback> callback) {
  (void)browser;
  (void)download_item;
  (void)suggested_name;
  if (!callback) {
    return false;
  }
  // 空路径 + 另存为：用系统默认下载目录和建议文件名。
  callback->Continue(CefString(), true);
  return true;
}

}  // namespace niuma

#endif
