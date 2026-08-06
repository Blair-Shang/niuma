#pragma once

#include "core/window/window_types.h"

#if NIUMMA_WITH_CEF
#include "include/cef_browser.h"
#include "include/cef_client.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

/**
 * 应用主窗口（AppShell）：进程内唯一。
 *
 * 职责：
 * - 启动时创建第一个顶层 Browser
 * - 记录主窗口 id，供生命周期判断（如「仅剩主窗关闭则退出」）
 * - 与 AuxiliaryWindowManager 分离，避免多窗口逻辑混在一起
 */
class MainWindow {
 public:
  static MainWindow& Instance();

  /** 创建主 Browser（仅应在应用启动时调用一次） */
  void Create(CefRefPtr<CefClient> client);

  int WindowId() const { return window_id_; }
  bool HasMain() const { return window_id_ > 0; }
  bool IsMain(int window_id) const;
  bool IsMainBrowser(CefRefPtr<CefBrowser> browser) const;

  void OnAttached(int window_id);
  void OnDetached(int window_id);

  /** 主窗口开始关闭：级联关闭 Splash 与所有辅助窗口 */
  void OnClosing();

  std::string ResolveStartupUrl() const;

 private:
  MainWindow() = default;

  int window_id_ = 0;
  bool closing_cascade_ = false;

  MainWindow(const MainWindow&) = delete;
  MainWindow& operator=(const MainWindow&) = delete;
};

/** @deprecated 请使用 MainWindow::Instance().Create；保留供 niuma_app 启动入口 */
void CreateMainBrowser(CefRefPtr<CefClient> client);
std::string ResolveStartupUrl();

#endif

}  // namespace niuma
