/**
 * SSH / SFTP 能力类型 —— `ssh.*` Bridge 契约（见 docs/16-ssh-sftp-module.md）。
 */
import type { ConnectionOptionsBase } from './connection'

/** SSH 连接选项（存于 connection_options JSON） */
export interface SshConnectionOptions extends ConnectionOptionsBase {
  timeout_seconds: number
  keepalive_seconds: number
  term_type: string
  encoding: 'utf-8'
  sftp_enabled: boolean
  verify_host_key: boolean
}

/** 默认 SSH 连接选项 */
export const DEFAULT_SSH_OPTIONS: SshConnectionOptions = {
  timeout_seconds: 30,
  keepalive_seconds: 60,
  term_type: 'xterm-256color',
  encoding: 'utf-8',
  sftp_enabled: true,
  verify_host_key: false,
  proxy: { type: 'none' },
}

/** 远程目录项 */
export interface SshSftpEntry {
  name: string
  kind: 'file' | 'dir' | 'link'
  size: number
  modifiedAt: string
  permissions: string
}

/** `ssh.session.open` 入参 */
export interface SshSessionOpenParams {
  profileId: string
}

/** `ssh.session.open` 返回 */
export interface SshSessionOpenResult {
  sessionId: string
}

/** `ssh.session.close` 入参 */
export interface SshSessionCloseParams {
  sessionId: string
}

/** `ssh.session.test` 入参 */
export interface SshSessionTestParams {
  profileId?: string
  hostAddress?: string
  portNumber?: number
  loginAccount?: string
  password?: string
  options?: SshConnectionOptions
}

/** `ssh.session.test` 返回 */
export interface SshSessionTestResult {
  ok: boolean
  message: string
}

/** `ssh.exec.run` 入参 */
export interface SshExecRunParams {
  sessionId: string
  command: string
  stream?: boolean
  execId?: string
}

/** `ssh.exec.run` 返回 */
export interface SshExecRunResult {
  execId: string
  streamed?: boolean
  stdout: string
  stderr: string
  exitCode: number
}

export type SshExecState = 'opening' | 'closed' | 'error'

/** `ssh.exec.data` 事件 */
export interface SshExecDataEvent {
  type: 'ssh.exec.data'
  execId: string
  sessionId: string
  stream: 'stdout' | 'stderr'
  data: string
}

/** `ssh.exec.exit` 事件 */
export interface SshExecExitEvent {
  type: 'ssh.exec.exit'
  execId: string
  sessionId: string
  exitCode?: number
}

/** `ssh.exec.state` 事件 */
export interface SshExecStateEvent {
  type: 'ssh.exec.state'
  execId: string
  sessionId: string
  state: SshExecState
  message?: string
}

/** `ssh.terminal.open` 入参 */
export interface SshTerminalOpenParams {
  sessionId: string
  cols: number
  rows: number
  termType?: string
}

/** `ssh.terminal.open` 返回 */
export interface SshTerminalOpenResult {
  terminalId: string
}

/** `ssh.terminal.input` 入参 */
export interface SshTerminalInputParams {
  terminalId: string
  data: string
}

/** `ssh.terminal.resize` 入参 */
export interface SshTerminalResizeParams {
  terminalId: string
  cols: number
  rows: number
}

/** `ssh.terminal.close` 入参 */
export interface SshTerminalCloseParams {
  terminalId: string
}

/** 终端生命周期状态 */
export type SshTerminalState = 'opening' | 'ready' | 'closed' | 'lost' | 'error'

/** `ssh.terminal.data` 事件 */
export interface SshTerminalDataEvent {
  type: 'ssh.terminal.data'
  terminalId: string
  sessionId: string
  stream: 'stdout' | 'stderr'
  data: string
}

/** `ssh.terminal.exit` 事件 */
export interface SshTerminalExitEvent {
  type: 'ssh.terminal.exit'
  terminalId: string
  sessionId: string
  exitCode?: number
}

/** `ssh.terminal.state` 事件 */
export interface SshTerminalStateEvent {
  type: 'ssh.terminal.state'
  terminalId: string
  sessionId: string
  state: SshTerminalState
  message?: string
}

/** `ssh.sftp.dir.list` 入参 */
export interface SshSftpDirListParams {
  sessionId: string
  path: string
}

/** `ssh.sftp.dir.list` 返回 */
export interface SshSftpDirListResult {
  path: string
  entries: SshSftpEntry[]
}

/** `ssh.sftp.file.read` 入参 */
export interface SshSftpFileReadParams {
  sessionId: string
  path: string
}

/** `ssh.sftp.file.read` 返回 */
export interface SshSftpFileReadResult {
  path?: string
  content: string
  size: number
}

/** `ssh.sftp.file.write` 入参 */
export interface SshSftpFileWriteParams {
  sessionId: string
  path: string
  content: string
}

/** `ssh.sftp.file.write` 返回 */
export interface SshSftpFileWriteResult {
  written: boolean
  path?: string
}

/** `ssh.sftp.dir.make` 入参 */
export interface SshSftpDirMakeParams {
  sessionId: string
  path: string
}

/** `ssh.sftp.dir.make` 返回 */
export interface SshSftpDirMakeResult {
  created: boolean
  path?: string
}

/** `ssh.sftp.entry.delete` 入参 */
export interface SshSftpEntryDeleteParams {
  sessionId: string
  path: string
  kind: 'file' | 'dir' | 'link'
  recursive?: boolean
}

/** `ssh.sftp.entry.delete` 返回 */
export interface SshSftpEntryDeleteResult {
  deleted: boolean
  path?: string
}

/** `ssh.sftp.entry.rename` 入参 */
export interface SshSftpEntryRenameParams {
  sessionId: string
  fromPath: string
  toPath: string
}

/** `ssh.sftp.entry.rename` 返回 */
export interface SshSftpEntryRenameResult {
  renamed: boolean
  fromPath?: string
  toPath?: string
}

/** `ssh.monitor.metrics` 入参 */
export interface SshMonitorMetricsParams {
  sessionId: string
}

/** `ssh.monitor.process.inspect` 入参 */
export interface SshMonitorProcessInspectParams {
  sessionId: string
  pid: number
}

/** 单个磁盘分区 */
export interface SshDiskPartition {
  device: string
  total: number
  used: number
  avail: number
  mountpoint: string
  inodeTotal: number
  inodeUsed: number
  inodeAvail: number
  iops: number
  readBps: number
  writeBps: number
  utilPct: number
}

/** 单核 CPU 使用率 */
export interface SshCpuCoreMetric {
  core: number
  /** 0–100 */
  usage: number
}

/** 网络接口流量（采样区间速率） */
export interface SshNetworkInterface {
  name: string
  /** 接收速率 bytes/s */
  rxBps: number
  /** 发送速率 bytes/s */
  txBps: number
  /** 是否为默认路由主网卡 */
  isPrimary?: boolean
}

/** Top 进程资源占用 */
export interface SshProcessMetric {
  pid: number
  user: string
  threads: number
  name: string
  /** CPU 占用 % */
  cpuPct: number
  /** 内存占用 % */
  memPct: number
  /** RSS 字节 */
  rss: number
}

/** 进程详细信息 */
export interface SshProcessDetail {
  pid: number
  name: string
  user: string
  ppid: number
  threads: number
  state: string
  startTime: string
  cpuPct: number
  memPct: number
  rss: number
  fdCount: number
  exe: string
  cwd: string
  cmdline: string
}

/** TCP 连接状态概览 */
export interface SshTcpConnections {
  total: number
  established: number
  timeWait: number
  listen: number
  synSent: number
  synRecv: number
}

/** `ssh.monitor.metrics` 返回：远程主机系统指标（结构化 JSON，由后端解析） */
export interface SshMonitorMetricsResult {
  cpuModel: string
  cpuCores: number
  /** CPU 总使用率 0–100 */
  cpuUsage: number
  cpuCoresDetail: SshCpuCoreMetric[]
  kernelVersion: string
  osName: string
  uptime: string
  loadAvg1: number
  loadAvg5: number
  loadAvg15: number
  processes: number
  threads: number
  /** 字节 */
  memTotal: number
  /** 字节 */
  memUsed: number
  /** 字节 */
  memAvailable: number
  /** 字节 */
  memBuffers: number
  /** 字节 */
  memCached: number
  /** 字节 */
  memSlab: number
  /** 字节 */
  swapTotal: number
  /** 字节 */
  swapUsed: number
  tcpConnections: SshTcpConnections
  /** 全接口接收速率合计 bytes/s */
  networkRxBps: number
  /** 全接口发送速率合计 bytes/s */
  networkTxBps: number
  networkPrimaryIface?: string | null
  networkInterfaces: SshNetworkInterface[]
  topProcesses: SshProcessMetric[]
  topMemoryProcesses: SshProcessMetric[]
  disks: SshDiskPartition[]
}

/** SSH 传输方向 / 状态（与 FTP 契约一致） */
export type SshTransferDirection = 'upload' | 'download'
export type SshTransferState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'canceled'

export interface SshTransferTask {
  taskId: string
  sessionId: string
  direction: SshTransferDirection
  localPath: string
  remotePath: string
  state: SshTransferState
  total: number
  transferred: number
  speedBps: number
  error?: string
}

export interface SshTransferEnqueueParams {
  sessionId: string
  direction: SshTransferDirection
  localPath: string
  remotePath: string
  overwrite?: 'overwrite' | 'skip' | 'rename' | 'resume'
}

export interface SshTransferEnqueueResult {
  taskId: string
}

export interface SshTransferTaskParams {
  taskId: string
}

export interface SshTransferListParams {
  sessionId?: string
}

export interface SshTransferListResult {
  tasks: SshTransferTask[]
}
