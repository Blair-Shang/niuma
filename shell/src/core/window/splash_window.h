#pragma once

#include "core/window/window_types.h"

#if NIUMMA_WITH_CEF
#include "include/cef_client.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

/**
 * 冷启动品牌窗（Splash）：进程内唯一，仅存在于启动阶段。
 *
 * 生命周期：
 * 1. OnContextInitialized 中先于 Main 创建，加载静态 splash.html（无 Vue）
 * 2. OnLoadStart 即 Reveal（不走 Web shell.window.reveal）
 * 3. 主窗首次 Reveal 成功后 Close；主窗关闭级联时也会 Close
 * 4. 热重载 / 之后再 reveal 主窗时不再创建（window_id_ 已清空）
 *
 * 与 Auxiliary 的区别：
 * - 无 route 复用、不参与 shell.window.open 业务列表
 * - 关闭不广播 shell.window.closed，也不触发进程退出（主窗仍在登记表中）
 * - closable=false 防用户误关；Shell Close 时通过 AllowShellClose() 放行 CanClose
 *
 * 注意（Views/Alloy）：CefWindowDelegate::CanClose 返回 false 时，
 * CloseBrowser(true) 也无法销毁顶层窗——必须先置 closing_ 再走 window->Close()。
 */
class SplashWindow {
 public:
  static SplashWindow& Instance();

  /** 创建小启动窗；已存在则幂等返回。须在 UI 线程调用。 */
  void Create(CefRefPtr<CefClient> client);

  /**
   * 关闭启动窗。可重复调用（主窗 reveal 可能因早退路径多次触发）。
   * 先 Hide 立刻从视觉上消失，再经 CanClose（AllowShellClose）销毁。
   */
  void Close();

  /**
   * 供 NiuMaWindowDelegate::CanClose 查询：仅 Shell 发起的 Close 期间为 true。
   * 用户 Alt+F4 / 系统关闭在 closable=false 时仍被拒绝。
   */
  bool AllowShellClose() const { return closing_; }

  int WindowId() const { return window_id_; }
  bool HasSplash() const { return window_id_ > 0; }
  bool IsSplash(int window_id) const;

  /** WindowManager 在 Browser Attach/Detach 时回调，同步 window_id_ */
  void OnAttached(int window_id);
  void OnDetached(int window_id);

 private:
  SplashWindow() = default;

  int window_id_ = 0;
  /** Shell Close 进行中：放行 CanClose；OnDetached 后清零 */
  bool closing_ = false;

  SplashWindow(const SplashWindow&) = delete;
  SplashWindow& operator=(const SplashWindow&) = delete;
};

#endif

}  // namespace niuma
