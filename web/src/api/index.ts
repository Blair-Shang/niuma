/**
 * Web ↔ Shell / Platform 统一 API 入口。
 *
 * - 类型：`@/api/types`
 * - 传输：`@/api/client`（扩展系统或底层需要时使用）
 * - 业务：各 `*Api` 模块
 */

export { bridgeInvoke, bridgeOnEvent, isBridgeAvailable } from './client'
export { ensureBridgeEventBus, subscribeBridgeEvent, subscribeBridgeEventByPrefix } from './event-bus'

export { shellApi } from './shell'
export { fsApi } from './fs'
export { dialogApi } from './dialog'
export { windowApi } from './window'
export { pluginApi } from './plugin'
export { settingsApi } from './settings'
export { connectionApi, credentialApi, ftpApi } from './ftp'
export { sshApi } from './ssh'
export { fileEditorApi } from './file-editor'

export type * from './types'
