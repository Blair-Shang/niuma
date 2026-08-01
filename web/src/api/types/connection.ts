/**
 * 能力连接框架公共类型 —— `platform.connection.*` / `connection_options.proxy`
 * （见 docs/14-capability-connection-framework.md）。
 */

/** 代理类型（存于 connection_options.proxy） */
export type ProxyType = 'none' | 'http' | 'socks4' | 'socks4a' | 'socks5'

/** 连接代理配置 */
export interface ProxyOptions {
  type: ProxyType
  host?: string
  port?: number
  username?: string
  password?: string
}

export type TunnelType = 'none' | 'ssh'

export interface InjectedSshTunnelProfile {
  hostAddress: string
  portNumber: number
  loginAccount: string
  /** 认证凭据；新字段名为 `secret`（platform 注入）。 */
  secret: string
  options?: Record<string, unknown>
}

/** SSH 隧道配置：敏感凭据仅由 platform 运行时注入，不落 connection_options。 */
export interface TunnelOptions {
  type: TunnelType
  sshProfileId?: string
  targetHost?: string
  targetPort?: number
  /** platform 运行时注入；FTP / SSH / Redis service 均已消费隧道拨号 */
  sshProfile?: InjectedSshTunnelProfile
}

/** 各 connection_kind 的 options 公共字段 */
export interface ConnectionOptionsBase {
  proxy?: ProxyOptions
  tunnel?: TunnelOptions
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
  kind: 'password' | 'ssh_private_key'
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

/** 导出包中的前端组织层（文件夹），由 Web 管理、platform 透传。 */
export interface ConnectionExportOrganization {
  folders: Array<{
    id: string
    name: string
    parentId: string | null
    profileIds: string[]
    accentColor?: string
  }>
  rootOrder: string[]
}

/** `platform.connection.export` 入参 */
export interface ConnectionExportParams {
  /** 本机目标文件路径 */
  path: string
  /** 为空则导出全部站点；否则仅导出指定站点 */
  profileIds?: string[]
  /** 前端文件夹结构（opaque，写入文件） */
  organization?: ConnectionExportOrganization | null
  /** 是否把凭据写入口令加密信封（导入后可直接连接） */
  includeSecrets?: boolean
  /** includeSecrets 时必填；用于 Argon2id 派生密钥 */
  passphrase?: string
}

/** `platform.connection.export` 返回 */
export interface ConnectionExportResult {
  exported: number
  path: string
  includeSecrets?: boolean
}

/** `platform.connection.import` 入参 */
export interface ConnectionImportParams {
  path: string
  /** 文件含加密凭据时必填 */
  passphrase?: string
}

/** `platform.connection.import` 返回 */
export interface ConnectionImportResult {
  imported: number
  skipped: number
  withSecrets?: number
  hasSecrets?: boolean
  /** exportId → 新建 profileId */
  idMap: Record<string, string>
  organization?: ConnectionExportOrganization | null
}

/** `platform.credential.get` 入参（按站点 ID 从 OS Keychain 读取明文凭据，仅供本地 IPC） */
export interface CredentialGetParams {
  profileId: string
}

/** `platform.credential.get` 返回 */
export interface CredentialGetResult {
  /** 凭据明文；found 为 false 时为空字符串 */
  secret: string
  /** 站点存在已关联凭据且读取成功时为 true */
  found: boolean
}

/** `platform.credential.set` 入参 */
export interface CredentialSetParams {
  credentialId?: string
  label: string
  kind: 'password' | 'ssh_private_key'
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

export const DEFAULT_TUNNEL_OPTIONS: TunnelOptions = {
  type: 'none',
  sshProfileId: '',
  targetHost: '',
  targetPort: 0,
}

export function defaultProxyPort(type: ProxyType): number {
  if (type === 'http') {
    return 8080
  }
  return 1080
}
