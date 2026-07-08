#include "browser/handlers/drag_handler.h"

#if NIUMMA_WITH_CEF
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_helpers.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

namespace {

constexpr char kFileDropHookJs[] = R"JS(
(function() {
  if (window.__niumaFileDropInstalled) return;
  window.__niumaFileDropInstalled = true;
  const prevent = function(e) {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('dragover', prevent, false);
  document.addEventListener('dragover', prevent, false);
  window.addEventListener('drop', function(e) {
    prevent(e);
    const paths = [];
    if (e.dataTransfer && e.dataTransfer.files) {
      for (let i = 0; i < e.dataTransfer.files.length; ++i) {
        const file = e.dataTransfer.files[i];
        if (file && file.path) paths.push(file.path);
      }
    }
    if (paths.length) {
      window.dispatchEvent(new CustomEvent('niuma:file-drop', {
        detail: { paths: paths }
      }));
    }
  }, false);
})();
)JS";

}  // namespace

bool NiuMaDragHandler::OnDragEnter(CefRefPtr<CefBrowser> browser,
                                   CefRefPtr<CefDragData> drag_data,
                                   DragOperationsMask mask) {
  CEF_REQUIRE_UI_THREAD();
  (void)browser;
  (void)mask;
  if (drag_data && drag_data->IsFile()) {
    return false;
  }
  return false;
}

void NiuMaDragHandler::OnDraggableRegionsChanged(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    const std::vector<CefDraggableRegion>& regions) {
  CEF_REQUIRE_UI_THREAD();
  (void)frame;
  if (auto browser_view = CefBrowserView::GetForBrowser(browser)) {
    if (auto window = browser_view->GetWindow()) {
      window->SetDraggableRegions(regions);
    }
  }
}

void NiuMaDragHandler::InstallFileDropHooks(CefRefPtr<CefFrame> frame) {
  if (!frame || !frame->IsMain()) {
    return;
  }
  frame->ExecuteJavaScript(kFileDropHookJs, frame->GetURL(), 0);
}

#endif

}  // namespace niuma
