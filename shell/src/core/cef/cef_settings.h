#pragma once

#if NIUMMA_WITH_CEF
#include "include/cef_app.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF
void ConfigureCefSettings(CefSettings& settings);
#endif

}  // namespace niuma
