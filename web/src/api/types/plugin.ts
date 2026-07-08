import type { ExtensionManifest } from '@/extensions/types/manifest'

/** `shell.plugin.list` / `platform.plugin.list` 单条插件记录 */
export interface PluginRecord {
  /** 相对 `plugins/` 的根路径，如 `_examples/hello-module` */
  root: string
  /** manifest.id；Shell P2+ 直接返回 */
  pluginId?: string
  /** 用户是否启用；`false` 时启动/bootstrap 应跳过 */
  enabled?: boolean
  /** 插件 manifest 对象或 JSON 字符串（Bridge 可能两种都返回） */
  manifest: ExtensionManifest
}

/** 插件列表 Bridge 响应 */
export interface PluginListResult {
  plugins: PluginRecord[]
}

/** `shell.plugin.setEnabled` 请求参数 */
export interface SetPluginEnabledParams {
  /** 目标插件 id（manifest.id） */
  pluginId: string
  /** 下一启用状态 */
  enabled: boolean
}

/** `shell.plugin.setEnabled` Bridge 响应 */
export interface SetPluginEnabledResult {
  pluginId: string
  enabled: boolean
}
