/**
 * 应用级 KV 配置类型 —— 对应 Platform 层 SQLite `nm_app_setting` 表。
 *
 * 壳层（CEF C++）对这些方法只做透传，不解析业务；持久化的唯一裁决点在 Platform。
 */

/** `platform.settings.get` 入参 */
export interface SettingGetParams {
  /** 配置键，如 `workspace.tabs` */
  key: string
}

/** `platform.settings.get` 返回 */
export interface SettingGetResult {
  /** 存储的 JSON 字符串；键不存在时为 null */
  value: string | null
}

/** `platform.settings.set` 入参 */
export interface SettingSetParams {
  /** 配置键 */
  key: string
  /** 要写入的 JSON 字符串 */
  value: string
}

/** `platform.settings.set` 返回 */
export interface SettingSetResult {
  /** 是否写入成功 */
  updated: boolean
}
