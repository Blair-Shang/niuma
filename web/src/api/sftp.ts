import { bridgeInvoke } from '@/api/client'
import type {
  SftpHostkeyRememberParams,
  SftpHostkeyRememberResult,
  SftpDirListParams,
  SftpDirListResult,
  SftpDirMakeParams,
  SftpDirMakeResult,
  SftpEntryDeleteParams,
  SftpEntryDeleteResult,
  SftpEntryRenameParams,
  SftpEntryRenameResult,
  SftpFileReadParams,
  SftpFileReadResult,
  SftpFileWriteParams,
  SftpFileWriteResult,
  SftpSessionCloseParams,
  SftpSessionOpenParams,
  SftpSessionOpenResult,
  SftpSessionTestParams,
  SftpSessionTestResult,
  SftpTransferEnqueueParams,
  SftpTransferEnqueueResult,
  SftpTransferListParams,
  SftpTransferListResult,
  SftpTransferTaskParams,
} from '@/api/types/sftp'

/**
 * SFTP 会话与远程文件（platform-core 代理至 sftp-service）。
 * 只开 SFTP 子系统，不申请 shell。
 */
export const sftpApi = {
  sessionOpen(params: SftpSessionOpenParams): Promise<SftpSessionOpenResult> {
    return bridgeInvoke<SftpSessionOpenResult>('sftp.session.open', params)
  },

  sessionClose(params: SftpSessionCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('sftp.session.close', params)
  },

  sessionTest(params: SftpSessionTestParams): Promise<SftpSessionTestResult> {
    return bridgeInvoke<SftpSessionTestResult>('sftp.session.test', params)
  },

  hostkeyRemember(params: SftpHostkeyRememberParams): Promise<SftpHostkeyRememberResult> {
    return bridgeInvoke<SftpHostkeyRememberResult>('sftp.hostkey.remember', params)
  },

  dirList(params: SftpDirListParams): Promise<SftpDirListResult> {
    return bridgeInvoke<SftpDirListResult>('sftp.dir.list', params)
  },

  dirMake(params: SftpDirMakeParams): Promise<SftpDirMakeResult> {
    return bridgeInvoke<SftpDirMakeResult>('sftp.dir.make', params)
  },

  entryDelete(params: SftpEntryDeleteParams): Promise<SftpEntryDeleteResult> {
    return bridgeInvoke<SftpEntryDeleteResult>('sftp.entry.delete', params)
  },

  entryRename(params: SftpEntryRenameParams): Promise<SftpEntryRenameResult> {
    return bridgeInvoke<SftpEntryRenameResult>('sftp.entry.rename', params)
  },

  transferEnqueue(params: SftpTransferEnqueueParams): Promise<SftpTransferEnqueueResult> {
    return bridgeInvoke<SftpTransferEnqueueResult>('sftp.transfer.enqueue', params)
  },

  transferCancel(params: SftpTransferTaskParams): Promise<{ canceled: boolean }> {
    return bridgeInvoke<{ canceled: boolean }>('sftp.transfer.cancel', params)
  },

  transferPause(params: SftpTransferTaskParams): Promise<{ paused: boolean }> {
    return bridgeInvoke<{ paused: boolean }>('sftp.transfer.pause', params)
  },

  transferResume(params: SftpTransferTaskParams): Promise<{ resumed: boolean }> {
    return bridgeInvoke<{ resumed: boolean }>('sftp.transfer.resume', params)
  },

  transferList(params: SftpTransferListParams = {}): Promise<SftpTransferListResult> {
    return bridgeInvoke<SftpTransferListResult>('sftp.transfer.list', params)
  },

  fileRead(params: SftpFileReadParams): Promise<SftpFileReadResult> {
    return bridgeInvoke<SftpFileReadResult>('sftp.file.read', params)
  },

  fileWrite(params: SftpFileWriteParams): Promise<SftpFileWriteResult> {
    return bridgeInvoke<SftpFileWriteResult>('sftp.file.write', params)
  },
} as const
