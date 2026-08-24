#pragma once

#include "session/manager.hpp"

#include <nlohmann/json.hpp>
#include <string>

namespace niuma::oracle::session {

/**
 * 读取当前会话 DBMS_OUTPUT 缓冲（GET_LINES），最多 max_lines 行。
 * 失败时返回空数组（不打断主语句成功）；用于过程调用 OUT 回显。
 */
nlohmann::json DrainDbmsOutput(Session& session, int max_lines = 200);

}  // namespace niuma::oracle::session
