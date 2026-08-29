/**
 * @file main.cpp
 * @brief NiuMa CEF 壳入口：多进程分发与 Browser 主循环。
 */
#include "core/cef/niuma_app.h"
#include "core/cef/cef_settings.h"
#include "core/runtime/service_manager.h"
#include "util/runtime_paths.h"
#include "util/session_log.h"

#include <iostream>
#include <string>

#if NIUMMA_WITH_CEF
#include "include/cef_app.h"
#if defined(OS_WIN)
#include <windows.h>
#endif
#if defined(__APPLE__)
#include "include/wrapper/cef_library_loader.h"
#endif
#endif

namespace {

#if NIUMMA_WITH_CEF
#if defined(OS_WIN)
int RunBrowserProcess(HINSTANCE instance) {
  CefMainArgs main_args(instance);
#else
int RunBrowserProcess(int argc, char* argv[]) {
  CefMainArgs main_args(argc, argv);
#endif
  CefRefPtr<niuma::NiuMaApp> app(new niuma::NiuMaApp());

  niuma::InitSessionLog();

  CefSettings settings;
  niuma::ConfigureCefSettings(settings);

  if (!CefInitialize(main_args, settings, app.get(), nullptr)) {
    std::cerr << "CefInitialize failed\n";
    return 1;
  }

  niuma::ServiceManager::Instance().Init(niuma::GetInstallDir());

  CefRunMessageLoop();

  niuma::ServiceManager::Instance().ShutdownAll();
  CefShutdown();
  return 0;
}
#endif

}  // namespace

#if defined(__APPLE__) && NIUMMA_WITH_CEF
static bool LoadMacCefFramework(int argc, char* argv[]) {
  static CefScopedLibraryLoader library_loader;
  bool helper = false;
  for (int i = 1; i < argc; ++i) {
    if (argv[i] && std::string(argv[i]).rfind("--type=", 0) == 0) {
      helper = true;
      break;
    }
  }
  if (helper) {
    return library_loader.LoadInHelper();
  }
  return library_loader.LoadInMain();
}
#endif

#if defined(OS_WIN)
int APIENTRY wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
#if NIUMMA_WITH_CEF
  CefMainArgs main_args(instance);
  CefRefPtr<niuma::NiuMaApp> app(new niuma::NiuMaApp());
  const int exit_code = CefExecuteProcess(main_args, app.get(), nullptr);
  if (exit_code >= 0) {
    return exit_code;
  }
  return RunBrowserProcess(instance);
#else
  (void)instance;
  std::cerr << "NiuMa: CEF not linked. Run: pnpm setup:desktop && pnpm dev\n";
  return 1;
#endif
}
#else
int main(int argc, char* argv[]) {
#if NIUMMA_WITH_CEF
#if defined(__APPLE__)
  if (!LoadMacCefFramework(argc, argv)) {
    std::cerr << "NiuMa: failed to load Chromium Embedded Framework\n";
    return 1;
  }
#endif
  CefMainArgs main_args(argc, argv);
  CefRefPtr<niuma::NiuMaApp> app(new niuma::NiuMaApp());
  const int exit_code = CefExecuteProcess(main_args, app.get(), nullptr);
  if (exit_code >= 0) {
    return exit_code;
  }
  return RunBrowserProcess(argc, argv);
#else
  (void)argc;
  (void)argv;
  std::cerr << "NiuMa: CEF not linked. Run: pnpm setup:desktop && pnpm dev\n";
  return 1;
#endif
}
#endif
