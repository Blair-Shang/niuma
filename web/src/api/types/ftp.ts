/**
 * FTP 能力类型 —— `ftp.*` Bridge 契约（见 docs/12-ftp-module.md）。
 *
 * 连接站点 / 凭据 / 代理公共类型见 `./connection`。
 */
import type { ConnectionOptionsBase } from './connection'

export type {
  ConnectionCreateParams,
  ConnectionCreateResult,
  ConnectionDeleteParams,
  ConnectionDeleteResult,
  ConnectionGetParams,
  ConnectionGetResult,
  ConnectionListParams,
  ConnectionListResult,
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionUpdateParams,
  ConnectionUpdateResult,
  CredentialDeleteParams,
  CredentialDeleteResult,
  CredentialInput,
  CredentialSetParams,
  CredentialSetResult,
  ProxyOptions,
  ProxyType,
} from './connection'

export { DEFAULT_PROXY_OPTIONS, defaultProxyPort } from './connection'

/** FTP/FTPS 连接选项（存于 connection_options JSON） */
export interface FtpConnectionOptions extends ConnectionOptionsBase {
  protocol: 'ftp' | 'ftps'
  tls_mode: 'none' | 'explicit' | 'implicit'
  passive: boolean
  encoding: 'utf-8' | 'gbk'
  transfer_type: 'binary' | 'ascii'
  tls_verify: boolean
  timeout_seconds: number
  keepalive_seconds: number
  anonymous: boolean
}

/** 默认 FTP 连接选项 */
export const DEFAULT_FTP_OPTIONS: FtpConnectionOptions = {
  protocol: 'ftp',
  tls_mode: 'none',
  passive: true,
  encoding: 'utf-8',
  transfer_type: 'binary',
  tls_verify: true,
  timeout_seconds: 30,
  keepalive_seconds: 60,
  anonymous: false,
  proxy: { type: 'none' },
}

/** 远程目录项 */
export interface FtpEntry {
  name: string
  kind: 'file' | 'dir' | 'link'
  size: number
  modifiedAt: string
  permissions: string
}

/** `ftp.session.open` 入参 */
export interface FtpSessionOpenParams {
  profileId: string
}

/** `ftp.session.open` 返回 */
export interface FtpSessionOpenResult {
  sessionId: string
}

/** `ftp.session.close` 入参 */
export interface FtpSessionCloseParams {
  sessionId: string
}

/** `ftp.session.test` 入参（已保存站点用 profileId；新建/改密时用内联连接参数） */
export interface FtpSessionTestParams {
  profileId?: string
  hostAddress?: string
  portNumber?: number
  loginAccount?: string
  password?: string
  options?: FtpConnectionOptions
}

/** `ftp.session.test` 返回 */
export interface FtpSessionTestResult {
  ok: boolean
  message: string
}

/** `ftp.dir.list` 入参 */
export interface FtpDirListParams {
  sessionId: string
  path: string
}

/** `ftp.dir.list` 返回 */
export interface FtpDirListResult {
  path: string
  entries: FtpEntry[]
}

/** `ftp.dir.make` 入参 */
export interface FtpDirMakeParams {
  sessionId: string
  path: string
}

/** `ftp.dir.make` 返回 */
export interface FtpDirMakeResult {
  created: boolean
}

/** `ftp.entry.delete` 入参 */
export interface FtpEntryDeleteParams {
  sessionId: string
  path: string
  kind: 'file' | 'dir' | 'link'
  recursive?: boolean
}

/** `ftp.entry.delete` 返回 */
export interface FtpEntryDeleteResult {
  deleted: boolean
}

/** `ftp.entry.rename` 入参 */
export interface FtpEntryRenameParams {
  sessionId: string
  fromPath: string
  toPath: string
}

/** `ftp.entry.rename` 返回 */
export interface FtpEntryRenameResult {
  renamed: boolean
}

/** 传输方向 */
export type FtpTransferDirection = 'upload' | 'download'

/** 传输任务状态 */
export type FtpTransferState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'canceled'

/** 传输任务 */
export interface FtpTransferTask {
  taskId: string
  sessionId: string
  direction: FtpTransferDirection
  localPath: string
  remotePath: string
  state: FtpTransferState
  total: number
  transferred: number
  speedBps: number
  error?: string
}

/** `ftp.transfer.enqueue` 入参 */
export interface FtpTransferEnqueueParams {
  sessionId: string
  direction: FtpTransferDirection
  localPath: string
  remotePath: string
  overwrite?: 'overwrite' | 'skip' | 'rename' | 'resume'
  limitBps?: number
}

/** `ftp.transfer.enqueue` 返回 */
export interface FtpTransferEnqueueResult {
  taskId: string
}

/** `ftp.transfer.cancel` 入参 */
export interface FtpTransferCancelParams {
  taskId: string
}

/** `ftp.transfer.pause` / `ftp.transfer.resume` 入参 */
export interface FtpTransferTaskParams {
  taskId: string
}

/** `ftp.transfer.list` 入参 */
export interface FtpTransferListParams {
  sessionId?: string
}

/** `ftp.transfer.list` 返回 */
export interface FtpTransferListResult {
  tasks: FtpTransferTask[]
}

/** `ftp.file.read` 入参 */
export interface FtpFileReadParams {
  sessionId: string
  path: string
}

/** `ftp.file.read` 返回 */
export interface FtpFileReadResult {
  content: string
  size: number
}

/** `ftp.file.write` 入参 */
export interface FtpFileWriteParams {
  sessionId: string
  path: string
  content: string
}

/** `ftp.file.write` 返回 */
export interface FtpFileWriteResult {
  written: boolean
}
