#pragma once

#include <vector>

#if NIUMMA_WITH_CEF
#include "include/cef_browser.h"
#include "include/cef_drag_handler.h"
#include "include/cef_frame.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

/** 外部文件拖入与窗口可拖拽区域；不含业务逻辑。 */
class NiuMaDragHandler : public CefDragHandler {
 public:
  bool OnDragEnter(CefRefPtr<CefBrowser> browser,
                   CefRefPtr<CefDragData> drag_data,
                   DragOperationsMask mask) override;

  void OnDraggableRegionsChanged(CefRefPtr<CefBrowser> browser,
                                 CefRefPtr<CefFrame> frame,
                                 const std::vector<CefDraggableRegion>& regions) override;

  static void InstallFileDropHooks(CefRefPtr<CefFrame> frame);

 private:
  IMPLEMENT_REFCOUNTING(NiuMaDragHandler);
};

#endif

}  // namespace niuma
