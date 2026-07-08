#pragma once

#include <string>
#include <vector>

namespace niuma {

/**
 * 本地 manifest 扫描结果（Shell 层，不含业务权限裁决）。
 */
struct LocalPluginRecord {
  /** 插件包根目录相对 plugins/ 的路径 */
  std::string root;
  /** manifest.json 中的 id 字段 */
  std::string plugin_id;
  /** manifest.json 全文 */
  std::string manifest_json;
};

/**
 * 扫描插件目录下的 manifest.json。
 *
 * @returns 找到的插件记录；目录不可读时返回空向量
 */
std::vector<LocalPluginRecord> ScanLocalPluginManifests();

/**
 * 将扫描结果序列化为 Bridge JSON。
 *
 * @param records - 扫描结果
 * @param enabled_only - true 时仅输出 IsPluginEnabled 为 true 的项
 * @returns `{"plugins":[{root,pluginId,enabled,manifest},...]}`
 */
std::string LocalPluginListJson(const std::vector<LocalPluginRecord>& records,
                                bool enabled_only);

}  // namespace niuma
