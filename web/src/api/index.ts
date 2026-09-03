/**
 * Web ↔ Shell / Platform 统一 API 入口。
 *
 * - 类型：`@/api/types`
 * - 传输：`@/api/client`（扩展系统或底层需要时使用）
 * - 业务：各 `*Api` 模块
 */

export { bridgeInvoke, bridgeOnEvent, isBridgeAvailable, BridgeError, BRIDGE_PROTOCOL_VERSION } from './client'
export { isPlatformUnavailable, withPlatformRetry } from './platform'
export { ensureBridgeEventBus, subscribeBridgeEvent, subscribeBridgeEventByPrefix } from './event-bus'

export { shellApi } from './shell'
export { fsApi } from './fs'
export { dialogApi } from './dialog'
export { windowApi } from './window'
export { pluginApi } from './plugin'
export { settingsApi } from './settings'
export { apiHistoryApi } from './api-history'
export { apiSocketApi } from './api-socket'
export { diagApi } from './diag'
export { componentsApi } from './components'
export { aiApi } from './ai'
export { connectionApi, credentialApi, ftpApi } from './ftp'
export { sshApi } from './ssh'
export { sftpApi } from './sftp'
export { shellStreamApi } from './stream'
export { redisApi } from './redis'
export { mongodbApi } from './mongodb'
export { vastbaseApi } from './vastbase'
export { mysqlApi } from './mysql'
export { sqliteApi } from './sqlite'
export { damengApi } from './dameng'
export { oracleApi } from './oracle'
export { clickhouseApi } from './clickhouse'
export { kingbaseApi } from './kingbase'
export { sqlserverApi } from './sqlserver'
export { postgresApi } from './postgres'
export { fileEditorApi } from './file-editor'

export type * from './types'
