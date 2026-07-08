/**
 * 能力连接框架公共类型 —— `platform.connection.*` / `connection_options.proxy`
 * （见 docs/14-capability-connection-framework.md）。
 */

/** 代理类型（存于 connection_options.proxy） */
export type ProxyType = 'none' | 'http' | 'socks5'

/** 连接代理配置 */
export interface ProxyOptions {
  type: ProxyType
  host?: string
  port?: number
  username?: string
  password?: string
}

/** 各 connection_kind 的 options 公共字段 */
export interface ConnectionOptionsBase {
  proxy?: ProxyOptions
  accentColor?: string
}

/** 连接站点（出参，不含密码） */
export interface ConnectionProfile {
  profileId: string
  workspaceId: string
  profileName: string
  connectionKind: string
  hostAddress: string
  portNumber: number
  loginAccount: string
  connectionOptions: ConnectionOptionsBase & Record<string, unknown>
  recordStatus: string
  rowVersion: number
  createdAt: string
  updatedAt: string
  credentialIds: string[]
}

/** 新建/更新连接站点入参 */
export interface ConnectionProfileInput {
  workspaceId?: string
  profileName: string
  connectionKind?: string
  hostAddress: string
  portNumber: number
  loginAccount: string
  connectionOptions: ConnectionOptionsBase & Record<string, unknown>
}

/** 凭据写入入参（明文仅经 Bridge 下发，Platform 落 Keychain） */
export interface CredentialInput {
  credentialId?: string
  label: string
  kind: 'password'
  secret: string
}

/** `platform.connection.list` 入参 */
export interface ConnectionListParams {
  workspaceId?: string
  kind?: string
}

/** `platform.connection.list` 返回 */
export interface ConnectionListResult {
  profiles: ConnectionProfile[]
}

/** `platform.connection.get` 入参 */
export interface ConnectionGetParams {
  profileId: string
}

/** `platform.connection.get` 返回 */
export interface ConnectionGetResult {
  profile: ConnectionProfile | null
}

/** `platform.connection.create` 入参 */
export interface ConnectionCreateParams {
  profile: ConnectionProfileInput
  credential?: CredentialInput
}

/** `platform.connection.create` 返回 */
export interface ConnectionCreateResult {
  profileId: string
}

/** `platform.connection.update` 入参 */
export interface ConnectionUpdateParams {
  profileId: string
  profile: ConnectionProfileInput
  rowVersion: number
  credential?: CredentialInput
}

/** `platform.connection.update` 返回 */
export interface ConnectionUpdateResult {
  updated: boolean
  rowVersion: number
}

/** `platform.connection.delete` 入参 */
export interface ConnectionDeleteParams {
  profileId: string
}

/** `platform.connection.delete` 返回 */
export interface ConnectionDeleteResult {
  deleted: boolean
}

/** `platform.credential.set` 入参 */
export interface CredentialSetParams {
  credentialId?: string
  label: string
  kind: 'password'
  secret: string
}

/** `platform.credential.set` 返回 */
export interface CredentialSetResult {
  credentialId: string
}

/** `platform.credential.delete` 入参 */
export interface CredentialDeleteParams {
  credentialId: string
}

/** `platform.credential.delete` 返回 */
export interface CredentialDeleteResult {
  deleted: boolean
}

/** 默认代理配置 */
export const DEFAULT_PROXY_OPTIONS: ProxyOptions = {
  type: 'none',
  host: '',
  port: 1080,
  username: '',
  password: '',
}

export function defaultProxyPort(type: ProxyType): number {
  if (type === 'http') {
    return 8080
  }
  return 1080
}
