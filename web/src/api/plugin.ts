import { bridgeInvoke } from '@/api/client'
import type {
  PluginListResult,
  SetPluginEnabledParams,
  SetPluginEnabledResult,
} from '@/api/types/plugin'

/** 插件扫描与启用状态（Shell / Platform Bridge） */
export const pluginApi = {
  /**
   * 列出全部已扫描插件（含已禁用项）。
   *
   * @returns 插件根路径、manifest 与启用状态
   * @see Settings 页插件管理
   */
  listAll(): Promise<PluginListResult> {
    return bridgeInvoke<PluginListResult>('shell.plugin.list')
  },

  /**
   * 从 Platform 层拉取插件列表。
   *
   * @returns Platform 返回的插件集合
   * @throws Platform 未启动或未实现该方法时
   */
  listFromPlatform(): Promise<PluginListResult> {
    return bridgeInvoke<PluginListResult>('platform.plugin.list')
  },

  /**
   * 应用启动时加载已启用插件：优先 Platform，回退 Shell 并过滤 `enabled === false`。
   *
   * @returns 仅包含应参与路由注册的插件
   */
  async listEnabledForBootstrap(): Promise<PluginListResult> {
    try {
      return await pluginApi.listFromPlatform()
    } catch {
      const payload = await pluginApi.listAll()
      return {
        plugins: payload.plugins.filter((p) => p.enabled !== false),
      }
    }
  },

  /**
   * 切换插件启用状态（持久化到 Shell 本地配置）。
   *
   * @param params - 目标 `pluginId` 与下一状态 `enabled`
   * @returns 写入后的插件 id 与启用状态
   */
  setEnabled(params: SetPluginEnabledParams): Promise<SetPluginEnabledResult> {
    return bridgeInvoke<SetPluginEnabledResult>('shell.plugin.setEnabled', params)
  },
} as const
