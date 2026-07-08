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
  int min_width = 400;
  int min_height = 300;
};

#if NIUMMA_WITH_CEF

/** Shell 管理的顶层 CEF 窗口角色（同一进程内可并存多个 Auxiliary） */
enum class WindowKind {
  /** 应用主工作台：AppShell，进程内唯一，关闭后无其它主窗口则退出 */
  Main,
  /** 辅助顶层窗口：文件工作台、未来独立工具窗等，可多个 */
  Auxiliary,
  /** DevTools / 系统弹窗等，不参与业务窗口列表 */
  Popup,
};

#endif

}  // namespace niuma
