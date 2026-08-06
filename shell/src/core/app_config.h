#pragma once

namespace niuma {

/** 应用级配置（版本等）。构建期由 CMake / version:sync 注入宏。 */
class AppConfig {
 public:
  AppConfig() = delete;

  /** 产品语义化版本，默认 1.0.0 */
  static const char* Version();

  /** 构建号（git short sha 或 dev） */
  static const char* BuildId();
};

}  // namespace niuma
