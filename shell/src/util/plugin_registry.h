#pragma once

#include <string>

namespace niuma {

/**
 * 用户数据目录（插件启用状态等），如 %LOCALAPPDATA%\\NiuMa\\data\\
 */
std::string GetUserDataDir();

/**
 * 判断插件是否在用户禁用列表中。
 *
 * @param plugin_id - manifest.id
 * @returns 未在禁用列表中则为 true
 */
bool IsPluginEnabled(const std::string& plugin_id);

/**
 * 更新插件启用状态并持久化到用户数据目录。
 *
 * @param plugin_id - manifest.id
 * @param enabled - true 启用，false 禁用
 * @param error - 失败时写入原因
 * @returns 是否成功
 */
bool SetPluginEnabled(const std::string& plugin_id, bool enabled, std::string& error);

}  // namespace niuma
