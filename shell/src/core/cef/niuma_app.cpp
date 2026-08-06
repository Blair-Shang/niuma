#include "core/cef/niuma_app.h"

#if NIUMMA_WITH_CEF
#include "browser/main_browser.h"
#include "core/cef/niuma_render_process_handler.h"
#include "core/window/main_window.h"
#include "core/window/splash_window.h"
#include "protocol/app_scheme_handler.h"
#include "include/cef_command_line.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

NiuMaApp::NiuMaApp()
    : render_process_handler_(new NiuMaRenderProcessHandler()) {}

CefRefPtr<CefRenderProcessHandler> NiuMaApp::GetRenderProcessHandler() {
  return render_process_handler_;
}

void NiuMaApp::OnRegisterCustomSchemes(
    CefRawPtr<CefSchemeRegistrar> registrar) {
  registrar->AddCustomScheme(
      NIUMMA_APP_SCHEME,
      CEF_SCHEME_OPTION_STANDARD | CEF_SCHEME_OPTION_SECURE |
          CEF_SCHEME_OPTION_CORS_ENABLED | CEF_SCHEME_OPTION_FETCH_ENABLED);
}

void NiuMaApp::OnBeforeCommandLineProcessing(
    const CefString& process_type,
    CefRefPtr<CefCommandLine> command_line) {
  (void)process_type;
  command_line->AppendSwitch("disable-web-security");
  command_line->AppendSwitch("allow-file-access-from-files");
  command_line->AppendSwitch("use-alloy-style");
  command_line->AppendSwitchWithValue("lang", "zh-CN");
}

CefRefPtr<CefClient> NiuMaApp::GetDefaultClient() {
  return main_client_;
}

void NiuMaApp::OnContextInitialized() {
  RegisterAppScheme();
  main_client_ = new NiuMaClient();
  // 冷启动顺序固定：Splash 先创建以便尽早可见；Main 后创建并保持隐藏，
  // 直至 Web 首帧 shell.window.reveal（或 3s 兜底）。热重载不会再次走这里。
  SplashWindow::Instance().Create(main_client_);
  CreateMainBrowser(main_client_);
}

#endif

}  // namespace niuma
