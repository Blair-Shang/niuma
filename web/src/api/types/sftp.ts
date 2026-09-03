/**
 * SFTP 能力类型 —— `sftp.*` Bridge 契约。
 *
 * 独立 sftp-service：只开 SFTP 子系统，不申请 shell。
 * 认证字段与 SSH 对齐（密码 / 私钥 / 私钥文件）。
 */
import type { ConnectionOptionsBase } from './connection'
import type { SshAuthType } from './ssh'

export type { SshAuthType }

/** SFTP 连接选项（存于 connection_options JSON） */
export interface SftpConnectionOptions extends ConnectionOptionsBase {
  timeout_seconds: number
  keepalive_seconds: number
  encoding: 'utf-8' | 'gbk'
  verify_host_key: boolean
  auth_type: SshAuthType
  private_key_path?: string
  passphrase?: string
}

/** 默认 SFTP 连接选项 */
export const DEFAULT_SFTP_OPTIONS: SftpConnectionOptions = {
  timeout_seconds: 30,
  keepalive_seconds: 60,
  encoding: 'utf-8',
  verify_host_key: false,
  auth_type: 'password',
  private_key_path: '',
  passphrase: '',
  proxy: { type: 'none' },
}

/** 远程目录项 */
export interface SftpEntry {
  name: string
  kind: 'file' | 'dir' | 'link'
  size: number
  modifiedAt: string
  permissions: string
}

export interface SftpSessionOpenParams {
  profileId: string
}

export interface SftpSessionOpenResult {
  sessionId: string
}

export interface SftpSessionCloseParams {
  sessionId: string
}

export interface SftpSessionTestParams {
  profileId?: string
  hostAddress?: string
  portNumber?: number
  loginAccount?: string
  secret?: string
  options?: SftpConnectionOptions
}

export interface SftpSessionTestResult {
  ok: boolean
  message: string
}

/** `sftp.hostkey.remember` 入参 */
export interface SftpHostkeyRememberParams {
  host: string
  port?: number
}

/** `sftp.hostkey.remember` 返回 */
export interface SftpHostkeyRememberResult {
  remembered: boolean
  host: string
  port: number
  fingerprint: string
  algorithm: string
}

export interface SftpDirListParams {
  sessionId: string
  path: string
}

export interface SftpDirListResult {
  path: string
  entries: SftpEntry[]
}

export interface SftpDirMakeParams {
  sessionId: string
  path: string
}

export interface SftpDirMakeResult {
  created: boolean
  path?: string
}

export interface SftpEntryDeleteParams {
  sessionId: string
  path: string
  kind: 'file' | 'dir' | 'link'
  recursive?: boolean
}

export interface SftpEntryDeleteResult {
  deleted: boolean
  path?: string
}

export interface SftpEntryRenameParams {
  sessionId: string
  fromPath: string
  toPath: string
}

export interface SftpEntryRenameResult {
  renamed: boolean
  fromPath?: string
  toPath?: string
}

export type SftpTransferDirection = 'upload' | 'download'
export type SftpTransferState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'canceled'

export interface SftpTransferTask {
  taskId: string
  sessionId: string
  direction: SftpTransferDirection
  localPath: string
  remotePath: string
  state: SftpTransferState
  total: number
  transferred: number
  speedBps: number
  error?: string
}

export interface SftpTransferEnqueueParams {
  sessionId: string
  direction: SftpTransferDirection
  localPath: string
  remotePath: string
  overwrite?: 'overwrite' | 'skip' | 'rename' | 'resume'
}

export interface SftpTransferEnqueueResult {
  taskId: string
}

export interface SftpTransferTaskParams {
  taskId: string
}

export interface SftpTransferListParams {
  sessionId?: string
}

export interface SftpTransferListResult {
  tasks: SftpTransferTask[]
}

export interface SftpFileReadParams {
  sessionId: string
  path: string
}

export interface SftpFileReadResult {
  path?: string
  content: string
  size: number
}

export interface SftpFileWriteParams {
  sessionId: string
  path: string
  content: string
}

export interface SftpFileWriteResult {
  written: boolean
  path?: string
}
