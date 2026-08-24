#pragma once

#include "session/manager.hpp"

#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace niuma::oracle::session {

struct RoutineCallArg {
  std::string name;
  std::string type;
  std::string mode;  // IN | OUT | INOUT
  std::string value;
  bool is_null = false;
};

struct RoutineCallParams {
  std::string session_id;
  std::string schema;
  std::string name;
  std::string kind;  // procedure | function
  std::string return_type;
  std::vector<RoutineCallArg> args;
  int timeout_ms = 0;
  std::string request_id;

  static RoutineCallParams FromJson(const nlohmann::json& j);
};

/**
 * 专业化过程/函数调用：ODPI 绑定 IN/OUT，读回 OUT/INOUT（及函数返回值）为一行结果集。
 * 无 GTT / 不依赖 DBMS_OUTPUT；结果形状对齐 Dameng/MySQL/Kingbase（单行宽表 → 前端出参 KV）。
 */
nlohmann::json CallRoutine(Session& session, const RoutineCallParams& params, std::string& error);

}  // namespace niuma::oracle::session
