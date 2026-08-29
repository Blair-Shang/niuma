#pragma once

#if NIUMMA_WITH_CEF
#include "include/cef_context_menu_handler.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

/** 生产包去掉 Chromium 默认导航 / 打印 / 查看源代码菜单项，保留复制粘贴。 */
class NiuMaContextMenuHandler : public CefContextMenuHandler {
 public:
  void OnBeforeContextMenu(CefRefPtr<CefBrowser> browser,
                           CefRefPtr<CefFrame> frame,
                           CefRefPtr<CefContextMenuParams> params,
                           CefRefPtr<CefMenuModel> model) override;

  bool OnContextMenuCommand(CefRefPtr<CefBrowser> browser,
                            CefRefPtr<CefFrame> frame,
                            CefRefPtr<CefContextMenuParams> params,
                            int command_id,
                            EventFlags event_flags) override;

 private:
  IMPLEMENT_REFCOUNTING(NiuMaContextMenuHandler);
};

#endif

}  // namespace niuma
