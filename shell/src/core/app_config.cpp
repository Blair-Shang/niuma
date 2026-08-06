#include "core/app_config.h"

#ifndef NIUMMA_APP_VERSION
#define NIUMMA_APP_VERSION "1.0.0"
#endif

#ifndef NIUMMA_BUILD_ID
#define NIUMMA_BUILD_ID "dev"
#endif

namespace niuma {

const char* AppConfig::Version() { return NIUMMA_APP_VERSION; }

const char* AppConfig::BuildId() { return NIUMMA_BUILD_ID; }

}  // namespace niuma
