#pragma once

#include <string>

namespace niuma {

/** Web 侧 shell.window.open 与主窗口启动共用的创建参数 */
struct WindowCreateOptions {
  std::string url;
  std::string route;
  std::string title;
  int width = 1280;
  int height = 800;
  bool resizable = true;
  bool maximizable = true;
  bool minimizable = true;
  bool maximized = false;
  /** 无边框窗口，Web 自绘标题栏与窗口按钮 */
  bool frameless = true;
  /**
   * 用户是否可通过系统关闭手势关闭窗口。
   * false 时 CanClose 默认拒绝（Splash 防误关）。
   * Views 下即使 CloseBrowser(true) 也会问 CanClose；Shell 关闭 Splash
   * 须先 SplashWindow::Close() 置 AllowShellClose，再 window->Close()。
   */
  bool closable = true;
  int min_width = 400;
  int min_height = 300;
};

#if NIUMMA_WITH_CEF

/**
 * Shell 管理的顶层 CEF 窗口角色。
 * Main / Splash 进程内各至多一个；Auxiliary 可多个；Popup 为系统级次窗。
 * 多窗口业务（文件工作台等）走 Auxiliary，与 Splash 生命周期无关。
 */
enum class WindowKind {
  /** 应用主工作台：AppShell，进程内唯一；关闭后若无其它托管窗则退出 */
  Main,
  /**
   * 冷启动品牌窗：进程内唯一，仅启动阶段存在。
   * 主窗 reveal 后关闭；不参与 shell.window.open / closed 业务事件。
   */
  Splash,
  /** 辅助顶层窗口：文件工作台、未来独立工具窗等，可多个 */
  Auxiliary,
  /** DevTools / 系统弹窗等，不参与业务窗口列表 */
  Popup,
};

#endif

}  // namespace niuma
