#pragma once

#include <string>

#if NIUMMA_WITH_CEF
#include "include/cef_scheme.h"

class NiuMaAppSchemeHandlerFactory : public CefSchemeHandlerFactory {
 public:
  CefRefPtr<CefResourceHandler> Create(
      CefRefPtr<CefBrowser> browser,
      CefRefPtr<CefFrame> frame,
      const CefString& scheme_name,
      CefRefPtr<CefRequest> request) override;

 private:
  IMPLEMENT_REFCOUNTING(NiuMaAppSchemeHandlerFactory);
};
#endif

namespace niuma {

void RegisterAppScheme();
std::string GetWebResourcesPath();
std::string MimeTypeForPath(const std::string& path);

}  // namespace niuma
