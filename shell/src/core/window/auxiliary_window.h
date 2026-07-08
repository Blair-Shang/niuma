#pragma once

#include "core/window/window_types.h"

#include <string>
#include <unordered_map>

#if NIUMMA_WITH_CEF
#include "include/cef_client.h"
#endif

namespace niuma {

#if NIUMMA_WITH_CEF

/**
 * 辅助顶层窗口管理：文件工作台、未来独立工具窗等。
 *
 * 文件工作台（`/file-workbench`）查看与编辑共用同一顶层窗口，按 route 单例复用。
 * 其它辅助窗通过 shell.window.open 创建，可多个并存。
 */
class AuxiliaryWindowManager {
 public:
  static AuxiliaryWindowManager& Instance();

  /** 打开新的辅助窗口，返回 Shell 窗口 id */
  int Open(const WindowCreateOptions& opts);

  bool IsAuxiliary(int window_id) const;
  int FindReusableWindow(const WindowCreateOptions& opts);

  /** 主窗口关闭时级联关闭所有已挂载 / 待创建的辅助窗 */
  void CloseAll();

  void OnAttached(int window_id);
  void OnDetached(int window_id);

 private:
  AuxiliaryWindowManager() = default;

  std::string BuildReuseKey(const WindowCreateOptions& opts) const;

  // 辅助窗口默认按 route/url 复用，避免文件工作台等业务误开很多个重复顶层窗。
  std::unordered_map<std::string, int> reuse_key_to_window_id_;
  std::unordered_map<int, std::string> window_id_to_reuse_key_;

  AuxiliaryWindowManager(const AuxiliaryWindowManager&) = delete;
  AuxiliaryWindowManager& operator=(const AuxiliaryWindowManager&) = delete;
};

#endif

}  // namespace niuma
