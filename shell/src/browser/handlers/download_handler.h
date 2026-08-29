#pragma once

#if NIUMMA_WITH_CEF
#include "include/cef_download_handler.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

/** 允许网页触发的文件下载（设置页装工具、导出 blob），Alloy 默认会直接拒绝。 */
class NiuMaDownloadHandler : public CefDownloadHandler {
 public:
  bool CanDownload(CefRefPtr<CefBrowser> browser,
                   const CefString& url,
                   const CefString& request_method) override;

  bool OnBeforeDownload(CefRefPtr<CefBrowser> browser,
                        CefRefPtr<CefDownloadItem> download_item,
                        const CefString& suggested_name,
                        CefRefPtr<CefBeforeDownloadCallback> callback) override;

 private:
  IMPLEMENT_REFCOUNTING(NiuMaDownloadHandler);
};

#endif

}  // namespace niuma
