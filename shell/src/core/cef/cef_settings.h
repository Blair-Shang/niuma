#pragma once

#if NIUMMA_WITH_CEF
#include "include/cef_app.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF
void ConfigureCefSettings(CefSettings& settings);

// DevToolsAllowed 是否允许打开嵌入式开发者工具与远程调试端口。
// 仅开发运行（NIUMMA_DEV_URL / --url=http）或显式 --devtools 为 true。
bool DevToolsAllowed();
#endif

}  // namespace niuma
