#pragma once

#include <string>

namespace niuma {

/** 创建本次启动的日志目录并设置环境变量 NIUMMA_LOG_DIR（须在拉起子进程前调用）。
 *  根目录：NIUMMA_LOG_ROOT > 仓库根 logs/（向上找 package.json）> <installDir>/logs。 */
void InitSessionLog();

/** 当前会话日志目录；InitSessionLog 之前为空。 */
const std::string& GetSessionLogDir();

/** 追加一行到 shell.log（UTF-8）。 */
void AppendShellLog(const std::string& line);

}  // namespace niuma
