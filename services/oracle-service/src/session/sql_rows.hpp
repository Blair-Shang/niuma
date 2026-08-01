#pragma once

#include "session/manager.hpp"

#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace niuma::oracle::session {

// 执行只读 SELECT，返回字符串单元格行（每列 to_string / bytes）。
// 用于 tree/catalog；调用方负责 SQL 安全（绑定式拼接已在 list 内完成）。
struct SqlRowsResult {
  std::vector<std::vector<std::string>> rows;
  bool truncated = false;
};

bool ExecStringRows(Session& session, const std::string& sql, int limit_plus_one, SqlRowsResult& out,
                    std::string& error);

}  // namespace niuma::oracle::session
