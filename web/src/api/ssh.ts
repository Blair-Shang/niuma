import { bridgeInvoke } from '@/api/client'
import type {
  SshExecRunParams,
  SshExecRunResult,
  SshMonitorMetricsParams,
  SshMonitorMetricsResult,
  SshMonitorProcessInspectParams,
  SshProcessDetail,
  SshSessionCloseParams,
  SshSessionOpenParams,
  SshSessionOpenResult,
  SshSessionTestParams,
  SshSessionTestResult,
  SshSftpDirListParams,
  SshSftpDirListResult,
  SshSftpDirMakeParams,
  SshSftpDirMakeResult,
  SshSftpEntryDeleteParams,
  SshSftpEntryDeleteResult,
  SshSftpEntryRenameParams,
  SshSftpEntryRenameResult,
  SshSftpFileReadParams,
  SshSftpFileReadResult,
  SshSftpFileWriteParams,
  SshSftpFileWriteResult,
  SshTerminalCloseParams,
  SshTerminalInputParams,
  SshTerminalOpenParams,
  SshTerminalOpenResult,
  SshTerminalResizeParams,
  SshTransferEnqueueParams,
  SshTransferEnqueueResult,
  SshTransferListParams,
  SshTransferListResult,
  SshTransferTaskParams,
} from '@/api/types/ssh'

/**
 * SSH 会话、命令执行与 SFTP 文件能力（platform-core 代理至 ssh-service）。
 */
export const sshApi = {
  sessionOpen(params: SshSessionOpenParams): Promise<SshSessionOpenResult> {
    return bridgeInvoke<SshSessionOpenResult>('ssh.session.open', params)
  },

  sessionClose(params: SshSessionCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('ssh.session.close', params)
  },

  sessionTest(params: SshSessionTestParams): Promise<SshSessionTestResult> {
    return bridgeInvoke<SshSessionTestResult>('ssh.session.test', params)
  },

  execRun(params: SshExecRunParams): Promise<SshExecRunResult> {
    const execId = params.execId?.trim() ? params.execId : crypto.randomUUID()
    return bridgeInvoke<SshExecRunResult>('ssh.exec.run', {
      ...params,
      execId,
      stream: params.stream ?? true,
    })
  },

  terminalOpen(params: SshTerminalOpenParams): Promise<SshTerminalOpenResult> {
    return bridgeInvoke<SshTerminalOpenResult>('ssh.terminal.open', params)
  },

  terminalInput(params: SshTerminalInputParams): Promise<{ ok: boolean }> {
    return bridgeInvoke<{ ok: boolean }>('ssh.terminal.input', params)
  },

  terminalResize(params: SshTerminalResizeParams): Promise<{ ok: boolean }> {
    return bridgeInvoke<{ ok: boolean }>('ssh.terminal.resize', params)
  },

  terminalClose(params: SshTerminalCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('ssh.terminal.close', params)
  },

  sftpDirList(params: SshSftpDirListParams): Promise<SshSftpDirListResult> {
    return bridgeInvoke<SshSftpDirListResult>('ssh.sftp.dir.list', params)
  },

  sftpFileRead(params: SshSftpFileReadParams): Promise<SshSftpFileReadResult> {
    return bridgeInvoke<SshSftpFileReadResult>('ssh.sftp.file.read', params)
  },

  sftpFileWrite(params: SshSftpFileWriteParams): Promise<SshSftpFileWriteResult> {
    return bridgeInvoke<SshSftpFileWriteResult>('ssh.sftp.file.write', params)
  },

  sftpDirMake(params: SshSftpDirMakeParams): Promise<SshSftpDirMakeResult> {
    return bridgeInvoke<SshSftpDirMakeResult>('ssh.sftp.dir.make', params)
  },

  sftpEntryDelete(params: SshSftpEntryDeleteParams): Promise<SshSftpEntryDeleteResult> {
    return bridgeInvoke<SshSftpEntryDeleteResult>('ssh.sftp.entry.delete', params)
  },

  sftpEntryRename(params: SshSftpEntryRenameParams): Promise<SshSftpEntryRenameResult> {
    return bridgeInvoke<SshSftpEntryRenameResult>('ssh.sftp.entry.rename', params)
  },

  transferEnqueue(params: SshTransferEnqueueParams): Promise<SshTransferEnqueueResult> {
    return bridgeInvoke<SshTransferEnqueueResult>('ssh.transfer.enqueue', params)
  },

  transferCancel(params: SshTransferTaskParams): Promise<{ canceled: boolean }> {
    return bridgeInvoke<{ canceled: boolean }>('ssh.transfer.cancel', params)
  },

  transferPause(params: SshTransferTaskParams): Promise<{ paused: boolean }> {
    return bridgeInvoke<{ paused: boolean }>('ssh.transfer.pause', params)
  },

  transferResume(params: SshTransferTaskParams): Promise<{ resumed: boolean }> {
    return bridgeInvoke<{ resumed: boolean }>('ssh.transfer.resume', params)
  },

  transferList(params: SshTransferListParams = {}): Promise<SshTransferListResult> {
    return bridgeInvoke<SshTransferListResult>('ssh.transfer.list', params)
  },

  /** 采集远程主机系统性能指标（CPU/内存/磁盘/负载/进程等）。
   *  Shell 脚本编译在后端 ssh-service 二进制中，前端只收到结构化 JSON。
   */
  monitorMetrics(params: SshMonitorMetricsParams): Promise<SshMonitorMetricsResult> {
    return bridgeInvoke<SshMonitorMetricsResult>('ssh.monitor.metrics', params)
  },

  /** 查询单个进程的详细上下文，用于排障面板。 */
  monitorProcessInspect(params: SshMonitorProcessInspectParams): Promise<SshProcessDetail> {
    return bridgeInvoke<SshProcessDetail>('ssh.monitor.process.inspect', params)
  },
} as const
