#pragma once

#include <string>

namespace niuma::oracle::util {

// 可执行文件所在目录。
std::string ExecutableDir();

// Instant Client 旁载目录：环境变量 NIUMA_ORACLE_RUNTIME > bin/runtime/oracle > 空。
std::string OracleClientLibDir();

std::string DefaultIpcAddress();

}  // namespace niuma::oracle::util
