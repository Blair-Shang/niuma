#include "core/cef/cef_settings.h"

#include "util/runtime_paths.h"
#include "util/session_log.h"

#if NIUMMA_WITH_CEF
#include "include/cef_command_line.h"

#include <cstdlib>
#include <filesystem>
#endif

namespace fs = std::filesystem;

namespace {

bool IsDevRuntime() {
  if (const char* env = std::getenv("NIUMMA_DEV_URL")) {
    return env[0] != '\0';
  }
  CefRefPtr<CefCommandLine> command_line = CefCommandLine::GetGlobalCommandLine();
  if (!command_line) {
    return false;
  }
  const std::string url = command_line->GetSwitchValue("url");
  return url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0;
}

}  // namespace

namespace niuma {

#if NIUMMA_WITH_CEF

void ConfigureCefSettings(CefSettings& settings) {
  settings.windowless_rendering_enabled = false;
  settings.no_sandbox = true;
  // 默认浏览器/窗口底色设为暗色框架色（#181818），消除启动白屏一闪
  settings.background_color = 0xFF181818u;

  const auto runtime_dir = fs::path(GetRuntimeDir());
  CefString(&settings.root_cache_path).FromString((runtime_dir / "cef_cache").string());
  const fs::path log_dir =
      GetSessionLogDir().empty() ? fs::path(GetInstallDir()) : fs::path(GetSessionLogDir());
  CefString(&settings.log_file).FromString((log_dir / "cef.log").string());
  settings.log_severity = LOGSEVERITY_INFO;

  CefRefPtr<CefCommandLine> command_line = CefCommandLine::GetGlobalCommandLine();
  if (command_line && command_line->HasSwitch("resources-dir-path")) {
    CefString(&settings.resources_dir_path)
        .FromString(command_line->GetSwitchValue("resources-dir-path"));
  } else {
    CefString(&settings.resources_dir_path).FromString(GetCefResourcesDir());
  }
  if (command_line && command_line->HasSwitch("locales-dir-path")) {
    CefString(&settings.locales_dir_path)
        .FromString(command_line->GetSwitchValue("locales-dir-path"));
  } else {
    CefString(&settings.locales_dir_path).FromString(GetCefLocalesDir());
  }

  if (IsDevRuntime() || (command_line && command_line->HasSwitch("devtools"))) {
    settings.remote_debugging_port = 9222;
  }
}

#endif

}  // namespace niuma
