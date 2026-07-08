#include "bridge/bridge_router.h"
#include "core/runtime/service_manager.h"
#include "ipc/platform_client.h"
#include "util/json_util.h"
#include "util/runtime_paths.h"
#include "util/plugin_registry.h"
#include "util/plugin_scanner.h"

#if NIUMMA_WITH_CEF
#include "core/window/native_dialog.h"
#include "core/window/window_manager.h"
#include "core/window/window_registry.h"
#include "util/local_fs.h"
#include "util/win_clipboard.h"
#include "include/base/cef_callback.h"
#include "include/cef_command_line.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#endif

#include <functional>
#include <sstream>

namespace niuma {

namespace {

void Respond(BridgeCallback callback, const BridgeRequest& req, bool ok,
             const std::string& result, const std::string& error = {}) {
  BridgeResponse resp;
  resp.id = req.id;
  resp.ok = ok;
  resp.result = result;
  resp.error = error;
  callback(resp);
}

#if NIUMMA_WITH_CEF

void RunOnUiThread(std::function<void()> task) {
  if (CefCurrentlyOn(TID_UI)) {
    task();
    return;
  }
  CefPostTask(TID_UI, base::BindOnce([](std::function<void()> fn) { fn(); },
                                     std::move(task)));
}

void FillWindowOptions(WindowCreateOptions& opts, const std::string& params) {
  opts.url = JsonGetString(params, "url");
  opts.route = JsonGetString(params, "route");
  opts.title = JsonGetString(params, "title");
  opts.width = JsonGetInt(params, "width", 1280);
  opts.height = JsonGetInt(params, "height", 800);
  opts.resizable = JsonGetBool(params, "resizable", true);
  opts.maximizable = JsonGetBool(params, "maximizable", true);
  opts.minimizable = JsonGetBool(params, "minimizable", true);
  opts.maximized = JsonGetBool(params, "maximized", false);
  opts.frameless = JsonGetBool(params, "frameless", true);
  opts.min_width = JsonGetInt(params, "minWidth", 400);
  opts.min_height = JsonGetInt(params, "minHeight", 300);
}

/** 统一复用 WindowRegistry 的窗口解析规则，避免 Bridge 与窗口层逻辑漂移。 */
int ResolveWindowId(const BridgeRequest& req, int param_window_id) {
  return WindowRegistry::Instance().ResolveWindowId(param_window_id, req.caller_window_id);
}

bool DispatchWindowMethod(const BridgeRequest& req, BridgeCallback callback) {
  if (req.method == "shell.window.open") {
    RunOnUiThread([req, callback]() {
      WindowCreateOptions opts;
      FillWindowOptions(opts, req.params);
      const int window_id = WindowManager::Instance().Open(opts);
      std::ostringstream ss;
      ss << "{\"windowId\":" << window_id << "}";
      Respond(callback, req, true, ss.str());
    });
    return true;
  }

  if (req.method == "shell.window.close") {
    const int window_id = ResolveWindowId(req, JsonGetInt(req.params, "windowId", 0));
    RunOnUiThread([req, callback, window_id]() {
      const bool ok = WindowManager::Instance().Close(window_id);
      Respond(callback, req, ok, ok ? R"({"closed":true})" : "{}",
              ok ? "" : "window not found");
    });
    return true;
  }

  if (req.method == "shell.window.focus") {
    const int window_id = JsonGetInt(req.params, "windowId", 0);
    if (window_id <= 0) {
      Respond(callback, req, false, "{}", "windowId required");
      return true;
    }
    RunOnUiThread([req, callback, window_id]() {
      const bool ok = WindowManager::Instance().Focus(window_id);
      Respond(callback, req, ok, ok ? R"({"focused":true})" : "{}",
              ok ? "" : "window not found");
    });
    return true;
  }

  if (req.method == "shell.window.maximize") {
    const int window_id = ResolveWindowId(req, JsonGetInt(req.params, "windowId", 0));
    RunOnUiThread([req, callback, window_id]() {
      const bool ok = WindowManager::Instance().Maximize(window_id);
      Respond(callback, req, ok, ok ? R"({"maximized":true})" : "{}",
              ok ? "" : "window not found");
    });
    return true;
  }

  if (req.method == "shell.window.minimize") {
    const int window_id = ResolveWindowId(req, JsonGetInt(req.params, "windowId", 0));
    RunOnUiThread([req, callback, window_id]() {
      const bool ok = WindowManager::Instance().Minimize(window_id);
      Respond(callback, req, ok, ok ? R"({"minimized":true})" : "{}",
              ok ? "" : "window not found");
    });
    return true;
  }

  if (req.method == "shell.window.restore") {
    const int window_id = ResolveWindowId(req, JsonGetInt(req.params, "windowId", 0));
    RunOnUiThread([req, callback, window_id]() {
      const bool ok = WindowManager::Instance().Restore(window_id);
      Respond(callback, req, ok, ok ? R"({"restored":true})" : "{}",
              ok ? "" : "window not found");
    });
    return true;
  }

  if (req.method == "shell.window.fullscreen") {
    const int window_id = ResolveWindowId(req, JsonGetInt(req.params, "windowId", 0));
    const bool enabled = JsonGetBool(req.params, "enabled", true);
    RunOnUiThread([req, callback, window_id, enabled]() {
      const bool ok = WindowManager::Instance().SetFullscreen(window_id, enabled);
      Respond(callback, req, ok, ok ? R"({"fullscreen":true})" : "{}",
              ok ? "" : "window not found");
    });
    return true;
  }

  if (req.method == "shell.window.state") {
    const int window_id = ResolveWindowId(req, JsonGetInt(req.params, "windowId", 0));
    RunOnUiThread([req, callback, window_id]() {
      Respond(callback, req, true, WindowManager::Instance().StateJson(window_id));
    });
    return true;
  }

  if (req.method == "shell.window.list") {
    Respond(callback, req, true, WindowManager::Instance().ListJson());
    return true;
  }

  if (req.method == "shell.window.reveal") {
    const int window_id = ResolveWindowId(req, JsonGetInt(req.params, "windowId", 0));
    RunOnUiThread([req, callback, window_id]() {
      const bool ok = WindowManager::Instance().Reveal(window_id);
      Respond(callback, req, ok, ok ? R"({"revealed":true})" : "{}",
              ok ? "" : "window not found");
    });
    return true;
  }

  if (req.method == "shell.window.setTitle") {
    const int window_id = ResolveWindowId(req, JsonGetInt(req.params, "windowId", 0));
    const std::string title = JsonGetString(req.params, "title");
    RunOnUiThread([req, callback, window_id, title]() {
      const bool ok = !title.empty() && WindowManager::Instance().SetTitle(window_id, title);
      Respond(callback, req, ok, ok ? R"({"titleSet":true})" : "{}",
              ok ? "" : "window not found");
    });
    return true;
  }

  if (req.method == "shell.window.startResize") {
    const int window_id = ResolveWindowId(req, JsonGetInt(req.params, "windowId", 0));
    const std::string edge = JsonGetString(req.params, "edge");
    RunOnUiThread([req, callback, window_id, edge]() {
      const bool ok = WindowManager::Instance().StartResize(window_id, edge);
      Respond(callback, req, ok, ok ? R"({"resizing":true})" : "{}",
              ok ? "" : "window not found");
    });
    return true;
  }

  return false;
}

bool DispatchDialogMethod(const BridgeRequest& req, BridgeCallback callback) {
  const int window_id = ResolveWindowId(req, JsonGetInt(req.params, "windowId", 0));

  if (req.method == "shell.dialog.openFile") {
    RunOnUiThread([req, callback, window_id]() {
      CefRefPtr<CefBrowser> browser = WindowManager::Instance().FindBrowser(window_id);
      NativeDialog::OpenFile(browser, req.params,
                           [req, callback](bool ok, const std::string& result,
                                           const std::string& error) {
                             Respond(callback, req, ok, result, error);
                           });
    });
    return true;
  }

  if (req.method == "shell.dialog.saveFile") {
    RunOnUiThread([req, callback, window_id]() {
      CefRefPtr<CefBrowser> browser = WindowManager::Instance().FindBrowser(window_id);
      NativeDialog::SaveFile(browser, req.params,
                           [req, callback](bool ok, const std::string& result,
                                           const std::string& error) {
                             Respond(callback, req, ok, result, error);
                           });
    });
    return true;
  }

  if (req.method == "shell.dialog.openFolder") {
    RunOnUiThread([req, callback, window_id]() {
      CefRefPtr<CefBrowser> browser = WindowManager::Instance().FindBrowser(window_id);
      NativeDialog::OpenFolder(browser, req.params,
                             [req, callback](bool ok, const std::string& result,
                                             const std::string& error) {
                               Respond(callback, req, ok, result, error);
                             });
    });
    return true;
  }

  if (req.method == "shell.dialog.message") {
    RunOnUiThread([req, callback, window_id]() {
      CefRefPtr<CefBrowser> browser = WindowManager::Instance().FindBrowser(window_id);
      NativeDialog::Message(browser, req.params,
                          [req, callback](bool ok, const std::string& result,
                                          const std::string& error) {
                            Respond(callback, req, ok, result, error);
                          });
    });
    return true;
  }

  return false;
}

bool DispatchFsMethod(const BridgeRequest& req, BridgeCallback callback) {
  const std::string path = JsonGetString(req.params, "path");
  std::string error;

  if (req.method == "shell.fs.exists") {
    const bool exists = !path.empty() && LocalFs::Exists(path);
    Respond(callback, req, true, exists ? R"({"exists":true})" : R"({"exists":false})");
    return true;
  }

  if (req.method == "shell.fs.stat") {
    if (path.empty()) {
      Respond(callback, req, false, "{}", "path required");
      return true;
    }
    const std::string result = LocalFs::StatJson(path, error);
    Respond(callback, req, result.empty() ? false : true, result.empty() ? "{}" : result, error);
    return true;
  }

  if (req.method == "shell.fs.readText") {
    if (path.empty()) {
      Respond(callback, req, false, "{}", "path required");
      return true;
    }
    const std::string result = LocalFs::ReadText(path, error);
    Respond(callback, req, result.empty() ? false : true, result.empty() ? "{}" : result, error);
    return true;
  }

  if (req.method == "shell.fs.writeText") {
    if (path.empty()) {
      Respond(callback, req, false, "{}", "path required");
      return true;
    }
    const std::string content = JsonGetString(req.params, "content");
    const bool ok = LocalFs::WriteText(path, content, error);
    Respond(callback, req, ok, ok ? R"({"written":true})" : "{}", error);
    return true;
  }

  if (req.method == "shell.fs.showInFolder") {
    if (path.empty()) {
      Respond(callback, req, false, "{}", "path required");
      return true;
    }
    const bool ok = LocalFs::ShowInFolder(path, error);
    Respond(callback, req, ok, ok ? R"({"shown":true})" : "{}", error);
    return true;
  }

  if (req.method == "shell.fs.homeDir") {
    const std::string result = LocalFs::HomeDirJson(error);
    Respond(callback, req, result.empty() ? false : true, result.empty() ? "{}" : result, error);
    return true;
  }

  if (req.method == "shell.fs.listDir") {
    if (path.empty()) {
      Respond(callback, req, false, "{}", "path required");
      return true;
    }
    const std::string result = LocalFs::ListDirJson(path, error);
    Respond(callback, req, result.empty() ? false : true, result.empty() ? "{}" : result, error);
    return true;
  }

  if (req.method == "shell.fs.mkdir") {
    if (path.empty()) {
      Respond(callback, req, false, "{}", "path required");
      return true;
    }
    const bool ok = LocalFs::Mkdir(path, error);
    Respond(callback, req, ok, ok ? R"({"created":true})" : "{}", error);
    return true;
  }

  if (req.method == "shell.fs.rename") {
    const std::string from_path = JsonGetString(req.params, "fromPath");
    const std::string to_path = JsonGetString(req.params, "toPath");
    if (from_path.empty() || to_path.empty()) {
      Respond(callback, req, false, "{}", "fromPath and toPath required");
      return true;
    }
    const bool ok = LocalFs::Rename(from_path, to_path, error);
    Respond(callback, req, ok, ok ? R"({"renamed":true})" : "{}", error);
    return true;
  }

  if (req.method == "shell.fs.delete") {
    if (path.empty()) {
      Respond(callback, req, false, "{}", "path required");
      return true;
    }
    const bool ok = LocalFs::Delete(path, error);
    Respond(callback, req, ok, ok ? R"({"deleted":true})" : "{}", error);
    return true;
  }

  return false;
}

bool DispatchClipboardMethod(const BridgeRequest& req, BridgeCallback callback) {
  if (req.method == "shell.clipboard.readText") {
    RunOnUiThread([req, callback]() {
      std::string text;
      std::string error;
      const bool ok = ReadClipboardText(text, error);
      if (!ok) {
        Respond(callback, req, false, "{}", error);
        return;
      }
      std::ostringstream ss;
      ss << "{\"text\":" << JsonQuoteString(text) << "}";
      Respond(callback, req, true, ss.str());
    });
    return true;
  }

  if (req.method == "shell.clipboard.writeText") {
    const std::string text = JsonGetString(req.params, "text");
    RunOnUiThread([req, callback, text]() {
      std::string error;
      const bool ok = WriteClipboardText(text, error);
      Respond(callback, req, ok, ok ? R"({"written":true})" : "{}", error);
    });
    return true;
  }

  return false;
}

#endif

/**
 * 插件列表与启用状态 — Shell 直出；Platform Go 就绪前作为 platform.plugin.* 回退。
 */
bool DispatchPluginMethod(const BridgeRequest& req, BridgeCallback callback) {
  if (req.method == "shell.plugin.list") {
    const auto records = ScanLocalPluginManifests();
    Respond(callback, req, true, LocalPluginListJson(records, false));
    return true;
  }

  if (req.method == "platform.plugin.list") {
    const auto records = ScanLocalPluginManifests();
    Respond(callback, req, true, LocalPluginListJson(records, true));
    return true;
  }

  if (req.method == "shell.plugin.setEnabled" ||
      req.method == "platform.plugin.setEnabled") {
    const std::string plugin_id = JsonGetString(req.params, "pluginId");
    const bool enabled = JsonGetBool(req.params, "enabled", true);
    std::string error;
    const bool ok = SetPluginEnabled(plugin_id, enabled, error);
    Respond(callback, req, ok, ok ? R"({"updated":true})" : "{}", error);
    return true;
  }

  return false;
}

}  // namespace

BridgeRouter::BridgeRouter() : platform_client_(std::make_unique<PlatformClient>()) {}

BridgeRouter::~BridgeRouter() = default;

void BridgeRouter::Dispatch(const BridgeRequest& req, BridgeCallback callback) {
#if NIUMMA_WITH_CEF
  if (DispatchWindowMethod(req, callback)) {
    return;
  }
  if (DispatchDialogMethod(req, callback)) {
    return;
  }
  if (DispatchFsMethod(req, callback)) {
    return;
  }
  if (DispatchClipboardMethod(req, callback)) {
    return;
  }
#endif

  if (DispatchPluginMethod(req, callback)) {
    return;
  }

  auto parsed = ParseMethod(req.method);
  if (!parsed && req.method != "ping" && req.method != "shell.version" &&
      req.method != "shell.info") {
    BridgeResponse resp;
    resp.id = req.id;
    resp.ok = false;
    resp.error = "invalid method";
    callback(resp);
    return;
  }

  if (req.method == "ping") {
    BridgeResponse resp;
    resp.id = req.id;
    resp.ok = true;
    resp.result = R"({"pong":true})";
    callback(resp);
    return;
  }

  if (req.method == "shell.version") {
    BridgeResponse resp;
    resp.id = req.id;
    resp.ok = true;
    std::ostringstream ss;
    ss << R"({"version":")" << NIUMMA_APP_VERSION << R"(","layer":3,"build":")"
       << NIUMMA_BUILD_ID << R"("})";
    resp.result = ss.str();
    callback(resp);
    return;
  }

  if (req.method == "shell.info") {
    bool frameless = true;
    CefRefPtr<CefCommandLine> command_line = CefCommandLine::GetGlobalCommandLine();
    if (command_line && command_line->HasSwitch("native-frame")) {
      frameless = false;
    }
    BridgeResponse resp;
    resp.id = req.id;
    resp.ok = true;
    std::ostringstream ss;
    ss << R"({"runtime":"cef","platform":)" << JsonQuoteString(GetRuntimePlatformName())
       << R"(,"installDir":)" << JsonQuoteString(GetInstallDir())
       << R"(,"webPath":"app://niuma/","frameless":)"
       << (frameless ? "true" : "false") << "}";
    resp.result = ss.str();
    callback(resp);
    return;
  }

  const auto& service_id = parsed->first;
  const auto& action = parsed->second;

  if (!ServiceManager::Instance().EnsureRunning(service_id)) {
    BridgeResponse resp;
    resp.id = req.id;
    resp.ok = false;
    resp.error = "service unavailable: " + service_id;
    callback(resp);
    return;
  }

  platform_client_->Invoke(service_id, action, req.params,
                           [callback, id = req.id](bool ok, const std::string& data,
                                                   const std::string& err) {
                             BridgeResponse resp;
                             resp.id = id;
                             resp.ok = ok;
                             resp.result = data;
                             resp.error = err;
                             callback(resp);
                           });
}

}  // namespace niuma
