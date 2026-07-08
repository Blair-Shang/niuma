#include "core/window/native_dialog.h"

#include "util/json_util.h"

#if NIUMMA_WITH_CEF
#include "include/cef_browser.h"
#include "include/wrapper/cef_helpers.h"

#include <sstream>
#include <vector>

#if defined(OS_WIN)
#include <windows.h>
#include <shobjidl.h>
#include <shlobj.h>
#include <objbase.h>
#endif

namespace {

std::string JsonEscape(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (char c : value) {
    switch (c) {
      case '"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        out.push_back(c);
        break;
    }
  }
  return out;
}

std::string BuildFilePathsJson(const std::vector<std::string>& file_paths) {
  std::ostringstream ss;
  if (file_paths.empty()) {
    ss << R"({"canceled":true,"filePaths":[]})";
    return ss.str();
  }

  ss << R"({"canceled":false,"filePaths":[)";
  for (size_t i = 0; i < file_paths.size(); ++i) {
    if (i > 0) {
      ss << ',';
    }
    ss << '"' << JsonEscape(file_paths[i]) << '"';
  }
  ss << "]}";
  return ss.str();
}

std::string BuildFilePathsJson(const std::vector<CefString>& file_paths) {
  std::vector<std::string> paths;
  paths.reserve(file_paths.size());
  for (const auto& path : file_paths) {
    paths.push_back(path.ToString());
  }
  return BuildFilePathsJson(paths);
}

std::vector<CefString> BuildAcceptFilters(const std::string& params) {
  std::vector<CefString> filters;
  const std::string extensions = niuma::JsonGetString(params, "filters");
  if (!extensions.empty()) {
    filters.push_back("Files|" + extensions);
  }
  filters.push_back("All Files|*.*");
  return filters;
}

#if defined(OS_WIN)
std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) {
    return {};
  }
  const int size =
      MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()),
                          nullptr, 0);
  if (size <= 0) {
    return {};
  }
  std::wstring out(size, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()),
                      out.empty() ? nullptr : &out[0], size);
  return out;
}

CefWindowHandle ParentWindowHandle(CefRefPtr<CefBrowser> browser) {
  if (!browser) {
    return nullptr;
  }
  return browser->GetHost()->GetWindowHandle();
}

std::string WideToUtf8(const std::wstring& value) {
  if (value.empty()) {
    return {};
  }
  const int size = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, nullptr, 0,
                                       nullptr, nullptr);
  if (size <= 1) {
    return {};
  }
  std::string out(static_cast<size_t>(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, out.data(), size, nullptr,
                      nullptr);
  return out;
}

bool OpenFolderWithNativeDialog(HWND owner, const std::string& params,
                                std::string& result_json) {
  const HRESULT co_hr =
      CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
  const bool needs_uninit = co_hr == S_OK;
  if (FAILED(co_hr) && co_hr != RPC_E_CHANGED_MODE) {
    return false;
  }

  IFileOpenDialog* dialog = nullptr;
  HRESULT hr = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&dialog));
  if (FAILED(hr) || !dialog) {
    if (needs_uninit) {
      CoUninitialize();
    }
    return false;
  }

  DWORD options = 0;
  dialog->GetOptions(&options);
  dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM |
                     FOS_PATHMUSTEXIST | FOS_FILEMUSTEXIST);

  const std::wstring title = Utf8ToWide(niuma::JsonGetString(params, "title"));
  if (!title.empty()) {
    dialog->SetTitle(title.c_str());
  }

  const std::wstring ok_label = Utf8ToWide(niuma::JsonGetString(params, "okButtonLabel"));
  if (!ok_label.empty()) {
    dialog->SetOkButtonLabel(ok_label.c_str());
  }

  const std::wstring default_path = Utf8ToWide(niuma::JsonGetString(params, "defaultPath"));
  if (!default_path.empty()) {
    IShellItem* folder = nullptr;
    if (SUCCEEDED(SHCreateItemFromParsingName(default_path.c_str(), nullptr,
                                              IID_PPV_ARGS(&folder))) &&
        folder) {
      dialog->SetFolder(folder);
      folder->Release();
    }
  }

  hr = dialog->Show(owner);
  if (hr == HRESULT_FROM_WIN32(ERROR_CANCELLED)) {
    result_json = BuildFilePathsJson(std::vector<std::string>{});
    dialog->Release();
    if (needs_uninit) {
      CoUninitialize();
    }
    return true;
  }

  if (FAILED(hr)) {
    dialog->Release();
    if (needs_uninit) {
      CoUninitialize();
    }
    return false;
  }

  IShellItem* item = nullptr;
  hr = dialog->GetResult(&item);
  dialog->Release();
  if (FAILED(hr) || !item) {
    if (needs_uninit) {
      CoUninitialize();
    }
    return false;
  }

  PWSTR path = nullptr;
  hr = item->GetDisplayName(SIGDN_FILESYSPATH, &path);
  item->Release();
  if (FAILED(hr) || !path) {
    if (needs_uninit) {
      CoUninitialize();
    }
    return false;
  }

  const std::string utf8_path = WideToUtf8(path);
  CoTaskMemFree(path);
  if (needs_uninit) {
    CoUninitialize();
  }

  if (utf8_path.empty()) {
    result_json = BuildFilePathsJson(std::vector<std::string>{});
    return true;
  }

  result_json = BuildFilePathsJson(std::vector<std::string>{utf8_path});
  return true;
}
#endif

class FileDialogCallbackImpl : public CefRunFileDialogCallback {
 public:
  FileDialogCallbackImpl(niuma::NativeDialogCallback callback)
      : callback_(std::move(callback)) {}

  void OnFileDialogDismissed(const std::vector<CefString>& file_paths) override {
    if (callback_) {
      callback_(true, BuildFilePathsJson(file_paths), {});
      callback_ = nullptr;
    }
  }

 private:
  niuma::NativeDialogCallback callback_;

  IMPLEMENT_REFCOUNTING(FileDialogCallbackImpl);
};

}  // namespace

namespace niuma {

void NativeDialog::OpenFile(CefRefPtr<CefBrowser> browser, const std::string& params,
                            NativeDialogCallback callback) {
  CEF_REQUIRE_UI_THREAD();
  if (!browser) {
    callback(false, "{}", "browser unavailable");
    return;
  }

  const bool multiple = JsonGetBool(params, "multiple", false);
  const auto mode =
      multiple ? FILE_DIALOG_OPEN_MULTIPLE : static_cast<cef_file_dialog_mode_t>(FILE_DIALOG_OPEN);
  const CefString title(JsonGetString(params, "title"));
  const CefString default_path(JsonGetString(params, "defaultPath"));
  const std::vector<CefString> filters = BuildAcceptFilters(params);

  browser->GetHost()->RunFileDialog(mode, title, default_path, filters,
                                    new FileDialogCallbackImpl(std::move(callback)));
}

void NativeDialog::SaveFile(CefRefPtr<CefBrowser> browser, const std::string& params,
                            NativeDialogCallback callback) {
  CEF_REQUIRE_UI_THREAD();
  if (!browser) {
    callback(false, "{}", "browser unavailable");
    return;
  }

  const CefString title(JsonGetString(params, "title"));
  const CefString default_path(JsonGetString(params, "defaultPath"));
  const std::vector<CefString> filters = BuildAcceptFilters(params);

  browser->GetHost()->RunFileDialog(FILE_DIALOG_SAVE, title, default_path, filters,
                                    new FileDialogCallbackImpl(std::move(callback)));
}

void NativeDialog::OpenFolder(CefRefPtr<CefBrowser> browser, const std::string& params,
                              NativeDialogCallback callback) {
  CEF_REQUIRE_UI_THREAD();
  if (!browser) {
    callback(false, "{}", "browser unavailable");
    return;
  }

#if defined(OS_WIN)
  std::string result_json;
  if (OpenFolderWithNativeDialog(ParentWindowHandle(browser), params, result_json)) {
    callback(true, result_json, {});
    return;
  }
  callback(false, "{}", "failed to open folder dialog");
#else
  const CefString title(JsonGetString(params, "title"));
  const CefString default_path(JsonGetString(params, "defaultPath"));
  const std::vector<CefString> filters;

  browser->GetHost()->RunFileDialog(FILE_DIALOG_OPEN_FOLDER, title, default_path, filters,
                                    new FileDialogCallbackImpl(std::move(callback)));
#endif
}

void NativeDialog::Message(CefRefPtr<CefBrowser> browser, const std::string& params,
                           NativeDialogCallback callback) {
  CEF_REQUIRE_UI_THREAD();

#if defined(OS_WIN)
  const std::string type = JsonGetString(params, "type");
  const std::wstring message = Utf8ToWide(JsonGetString(params, "message"));
  const std::wstring title = Utf8ToWide(JsonGetString(params, "title"));

  UINT style = MB_OK;
  if (type == "confirm" || type == "question") {
    style = MB_OKCANCEL | MB_ICONQUESTION;
  } else if (type == "warning") {
    style = MB_OK | MB_ICONWARNING;
  } else if (type == "error") {
    style = MB_OK | MB_ICONERROR;
  } else if (type == "yesno") {
    style = MB_YESNO | MB_ICONQUESTION;
  } else {
    style = MB_OK | MB_ICONINFORMATION;
  }

  const int result =
      MessageBoxW(ParentWindowHandle(browser), message.c_str(), title.c_str(), style);

  std::string button = "ok";
  if (style & MB_YESNO) {
    button = (result == IDYES) ? "yes" : "no";
  } else if (style & MB_OKCANCEL) {
    button = (result == IDOK) ? "ok" : "cancel";
  } else if (result == IDCANCEL) {
    button = "cancel";
  }

  std::ostringstream ss;
  ss << R"({"button":")" << button << R"("})";
  callback(true, ss.str(), {});
#else
  (void)browser;
  (void)params;
  callback(false, "{}", "native message dialog is only supported on Windows");
#endif
}

#endif  // NIUMMA_WITH_CEF

}  // namespace niuma
