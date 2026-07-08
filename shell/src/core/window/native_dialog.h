#pragma once

#include <functional>
#include <string>

#if NIUMMA_WITH_CEF
#include "include/cef_browser.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

using NativeDialogCallback =
    std::function<void(bool ok, const std::string& result_json, const std::string& error)>;

/** Windows 原生文件/文件夹选择与 MessageBox，不含业务逻辑。 */
class NativeDialog {
 public:
  static void OpenFile(CefRefPtr<CefBrowser> browser, const std::string& params,
                       NativeDialogCallback callback);
  static void SaveFile(CefRefPtr<CefBrowser> browser, const std::string& params,
                       NativeDialogCallback callback);
  static void OpenFolder(CefRefPtr<CefBrowser> browser, const std::string& params,
                         NativeDialogCallback callback);
  static void Message(CefRefPtr<CefBrowser> browser, const std::string& params,
                      NativeDialogCallback callback);
};

#endif

}  // namespace niuma
