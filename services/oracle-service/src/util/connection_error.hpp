#pragma once

#include <string_view>

namespace niuma::oracle::util {

/** 是否为连接已断开类错误（DPI-1080 / ORA-03113 等）。 */
bool IsConnectionLost(std::string_view err);

}  // namespace niuma::oracle::util
