#include "core/window/main_window.h"

#include "core/window/auxiliary_window.h"
#include "core/window/splash_window.h"
#include "core/window/window_factory.h"
#include "core/window/window_registry.h"

#include "include/cef_command_line.h"
#include "include/wrapper/cef_helpers.h"

namespace niuma {

#if NIUMMA_WITH_CEF

MainWindow& MainWindow::Instance() {
  static MainWindow instance;
  return instance;
}

std::string MainWindow::ResolveStartupUrl() const {
  return WindowFactory::Instance().ResolveStartupUrl();
}

void MainWindow::Create(CefRefPtr<CefClient> client) {
  CEF_REQUIRE_UI_THREAD();
  WindowFactory::Instance().SetClient(client);
  if (HasMain()) {
    return;
  }

  WindowCreateOptions opts;
  opts.url = ResolveStartupUrl();
  opts.title = "NiuMa";
  opts.width = 1280;
  opts.height = 800;
  opts.min_width = 1024;
  opts.min_height = 640;
  CefRefPtr<CefCommandLine> command_line = CefCommandLine::GetGlobalCommandLine();
  if (command_line && command_line->HasSwitch("native-frame")) {
    opts.frameless = false;
  }

  const int id = WindowFactory::Instance().Create(WindowKind::Main, opts);
  window_id_ = id;
}

bool MainWindow::IsMain(int window_id) const {
  return window_id_ > 0 && window_id == window_id_;
}

bool MainWindow::IsMainBrowser(CefRefPtr<CefBrowser> browser) const {
  if (!browser || window_id_ <= 0) {
    return false;
  }
  const WindowRecord* entry = WindowRegistry::Instance().FindExact(window_id_);
  return entry && entry->browser && entry->browser->IsSame(browser);
}

void MainWindow::OnAttached(int window_id) {
  if (window_id_ <= 0) {
    window_id_ = window_id;
  }
}

void MainWindow::OnDetached(int window_id) {
  if (window_id_ == window_id) {
    window_id_ = 0;
    closing_cascade_ = false;
  }
}

void MainWindow::OnClosing() {
  CEF_REQUIRE_UI_THREAD();
  if (closing_cascade_) {
    return;
  }
  closing_cascade_ = true;
  // 若用户在主窗尚未 reveal 前异常退出路径走到这里，一并清掉 Splash
  SplashWindow::Instance().Close();
  AuxiliaryWindowManager::Instance().CloseAll();
}

#endif

// 兼容 niuma_app 等现有调用点
#if NIUMMA_WITH_CEF

void CreateMainBrowser(CefRefPtr<CefClient> client) {
  MainWindow::Instance().Create(client);
}

std::string ResolveStartupUrl() {
  return MainWindow::Instance().ResolveStartupUrl();
}

#endif

}  // namespace niuma
