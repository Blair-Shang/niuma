import { bridgeInvoke } from '@/api/client'
import type { SettingGetResult, SettingSetResult } from '@/api/types/settings'

/**
 * 应用级 KV 配置（Platform 层持久化，SQLite `nm_app_setting`）。
 *
 * 方法名走 `platform.*` 命名空间：壳层 `BridgeRouter` 解析为 `service=platform.settings`
 * 后原样转发给 Platform 应用 IPC，壳层不落盘、不解析业务（见 docs/architecture.md 壳层零业务）。
 */
export const settingsApi = {
  /**
   * 读取配置值。
   *
   * @param key - 配置键，如 `workspace.tabs`
   * @returns JSON 字符串或 null（键不存在）
   * @throws Platform 未启动/未实现时（调用方应回退本地缓存）
   */
  get(key: string): Promise<SettingGetResult> {
    return bridgeInvoke<SettingGetResult>('platform.settings.get', { key })
  },

  /**
   * 写入配置值。
   *
   * @param key - 配置键
   * @param value - JSON 字符串
   * @returns 是否写入成功
   * @throws Platform 未启动/未实现时（调用方应回退本地缓存）
   */
  set(key: string, value: string): Promise<SettingSetResult> {
    return bridgeInvoke<SettingSetResult>('platform.settings.set', { key, value })
  },
} as const
