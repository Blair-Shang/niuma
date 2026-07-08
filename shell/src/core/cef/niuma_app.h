#pragma once

#if NIUMMA_WITH_CEF
#include "include/cef_app.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF
class NiuMaApp : public CefApp,
                 public CefBrowserProcessHandler {
 public:
  NiuMaApp();

  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
    return this;
  }

  CefRefPtr<CefRenderProcessHandler> GetRenderProcessHandler() override;

  void OnRegisterCustomSchemes(
      CefRawPtr<CefSchemeRegistrar> registrar) override;

  void OnBeforeCommandLineProcessing(
      const CefString& process_type,
      CefRefPtr<CefCommandLine> command_line) override;

  void OnContextInitialized() override;

  CefRefPtr<CefClient> GetDefaultClient() override;

 private:
  CefRefPtr<CefRenderProcessHandler> render_process_handler_;
  CefRefPtr<CefClient> main_client_;

  IMPLEMENT_REFCOUNTING(NiuMaApp);
};
#endif

}  // namespace niuma
