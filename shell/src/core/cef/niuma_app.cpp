#include "core/cef/niuma_app.h"

#if NIUMMA_WITH_CEF
#include "browser/main_browser.h"
#include "core/cef/niuma_render_process_handler.h"
#include "core/window/main_window.h"
#include "core/window/splash_window.h"
#include "protocol/app_scheme_handler.h"
#include "include/cef_command_line.h"

#include <string>
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

namespace {

/** 合并 --name=a,b，避免第二次 Append 盖掉用户/调试已加的值。 */
void MergeCommaSwitch(CefRefPtr<CefCommandLine> command_line,
                      const char* name,
                      const char* extra) {
  std::string value = extra;
  if (command_line->HasSwitch(name)) {
    const std::string existing = command_line->GetSwitchValue(name).ToString();
    if (!existing.empty()) {
      value = existing + "," + extra;
    }
  }
  command_line->AppendSwitchWithValue(name, value);
}

}  // namespace

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
  // Chrome 137+ 默认禁用 SwiftShader。本机 GPU 崩溃后没有软件回退，
  // backdrop-filter / 合成会直接失败。允许 SwiftShader 以免界面透底。
  command_line->AppendSwitch("enable-unsafe-swiftshader");

  // 三端共用：桌面单窗不要按 Chrome 标签页做会话恢复 / 后台续下 / 丢页。
  command_line->AppendSwitch("no-first-run");
  command_line->AppendSwitch("disable-restore-session-state");
  // 不用 Google 账号。DICE 在无 OAuth client 时本来就是关的，这里显式禁止
  // Chrome 登录/同步，避免再去探 Gaia。缺 key 时 Chromium 仍可能打一次 WARNING。
  command_line->AppendSwitch("disable-sync");
  command_line->AppendSwitchWithValue("allow-browser-signin", "false");
  MergeCommaSwitch(
      command_line, "disable-features",
      "IntensiveWakeUpThrottling,WebContentsDiscard,DownloadAutoResumption");

#if defined(OS_WIN)
  // Win11 + 高 DPI 上 DComp Present / Graphite / Dawn 会把 GPU 进程打成
  // STATUS_BREAKPOINT。仍走硬件 ANGLE/D3D11，只换 Present 和实验渲染器。
  command_line->AppendSwitch("disable-direct-composition");
  command_line->AppendSwitchWithValue("use-angle", "d3d11");
  MergeCommaSwitch(
      command_line, "disable-features",
      "SkiaGraphite,SkiaGraphitePrecompilation,WebGPU,WebGPUService,Vulkan,"
      "DirectComposition,CalculateNativeWinOcclusion");
#elif defined(OS_LINUX)
  // Linux 显卡驱动差异大：关掉 Graphite/Vulkan/Dawn，走 ANGLE+GL。
  // 不要套 Windows 的 D3D11 / DirectComposition。
  MergeCommaSwitch(command_line, "disable-features",
                   "SkiaGraphite,SkiaGraphitePrecompilation,WebGPU,"
                   "WebGPUService,Vulkan");
#endif
  // macOS：保持默认 Metal（含 Graphite）。WebGPU/丢页已在上面按需关。
  // 不要 --use-angle=d3d11，也不要 disable-direct-composition。
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
