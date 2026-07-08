import { bridgeInvoke } from '@/api/client'
import type {
  ConnectionCreateParams,
  ConnectionCreateResult,
  ConnectionDeleteParams,
  ConnectionDeleteResult,
  ConnectionGetParams,
  ConnectionGetResult,
  ConnectionListParams,
  ConnectionListResult,
  ConnectionUpdateParams,
  ConnectionUpdateResult,
  CredentialDeleteParams,
  CredentialDeleteResult,
  CredentialSetParams,
  CredentialSetResult,
  FtpDirListParams,
  FtpDirListResult,
  FtpDirMakeParams,
  FtpDirMakeResult,
  FtpEntryDeleteParams,
  FtpEntryDeleteResult,
  FtpEntryRenameParams,
  FtpEntryRenameResult,
  FtpTransferCancelParams,
  FtpTransferTaskParams,
  FtpTransferEnqueueParams,
  FtpTransferEnqueueResult,
  FtpTransferListParams,
  FtpTransferListResult,
  FtpEntry,
  FtpSessionCloseParams,
  FtpSessionOpenParams,
  FtpSessionOpenResult,
  FtpSessionTestParams,
  FtpSessionTestResult,
  FtpFileReadParams,
  FtpFileReadResult,
  FtpFileWriteParams,
  FtpFileWriteResult,
} from '@/api/types/ftp'

/**
 * 连接站点 CRUD（Platform 层 SQLite `nm_connection_profile`）。
 */
export const connectionApi = {
  list(params: ConnectionListParams = {}): Promise<ConnectionListResult> {
    return bridgeInvoke<ConnectionListResult>('platform.connection.list', params)
  },

  get(params: ConnectionGetParams): Promise<ConnectionGetResult> {
    return bridgeInvoke<ConnectionGetResult>('platform.connection.get', params)
  },

  create(params: ConnectionCreateParams): Promise<ConnectionCreateResult> {
    return bridgeInvoke<ConnectionCreateResult>('platform.connection.create', params)
  },

  update(params: ConnectionUpdateParams): Promise<ConnectionUpdateResult> {
    return bridgeInvoke<ConnectionUpdateResult>('platform.connection.update', params)
  },

  delete(params: ConnectionDeleteParams): Promise<ConnectionDeleteResult> {
    return bridgeInvoke<ConnectionDeleteResult>('platform.connection.delete', params)
  },
} as const

/**
 * 凭据写入/删除（密钥落 OS Keychain，DB 仅存引用）。
 */
export const credentialApi = {
  set(params: CredentialSetParams): Promise<CredentialSetResult> {
    return bridgeInvoke<CredentialSetResult>('platform.credential.set', params)
  },

  delete(params: CredentialDeleteParams): Promise<CredentialDeleteResult> {
    return bridgeInvoke<CredentialDeleteResult>('platform.credential.delete', params)
  },
} as const

/**
 * FTP 会话与远程目录浏览（platform-core 代理至 ftp-service）。
 */
export const ftpApi = {
  sessionOpen(params: FtpSessionOpenParams): Promise<FtpSessionOpenResult> {
    return bridgeInvoke<FtpSessionOpenResult>('ftp.session.open', params)
  },

  sessionClose(params: FtpSessionCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('ftp.session.close', params)
  },

  sessionTest(params: FtpSessionTestParams): Promise<FtpSessionTestResult> {
    return bridgeInvoke<FtpSessionTestResult>('ftp.session.test', params)
  },

  dirList(params: FtpDirListParams): Promise<FtpDirListResult> {
    return bridgeInvoke<FtpDirListResult>('ftp.dir.list', params)
  },

  dirMake(params: FtpDirMakeParams): Promise<FtpDirMakeResult> {
    return bridgeInvoke<FtpDirMakeResult>('ftp.dir.make', params)
  },

  entryDelete(params: FtpEntryDeleteParams): Promise<FtpEntryDeleteResult> {
    return bridgeInvoke<FtpEntryDeleteResult>('ftp.entry.delete', params)
  },

  entryRename(params: FtpEntryRenameParams): Promise<FtpEntryRenameResult> {
    return bridgeInvoke<FtpEntryRenameResult>('ftp.entry.rename', params)
  },

  transferEnqueue(params: FtpTransferEnqueueParams): Promise<FtpTransferEnqueueResult> {
    return bridgeInvoke<FtpTransferEnqueueResult>('ftp.transfer.enqueue', params)
  },

  transferCancel(params: FtpTransferCancelParams): Promise<{ ok: boolean }> {
    return bridgeInvoke<{ ok: boolean }>('ftp.transfer.cancel', params)
  },

  transferPause(params: FtpTransferTaskParams): Promise<{ ok: boolean }> {
    return bridgeInvoke<{ ok: boolean }>('ftp.transfer.pause', params)
  },

  transferResume(params: FtpTransferTaskParams): Promise<{ ok: boolean }> {
    return bridgeInvoke<{ ok: boolean }>('ftp.transfer.resume', params)
  },

  transferList(params: FtpTransferListParams = {}): Promise<FtpTransferListResult> {
    return bridgeInvoke<FtpTransferListResult>('ftp.transfer.list', params)
  },

  /** 读取远程 FTP 文件文本（上限 10 MB） */
  fileRead(params: FtpFileReadParams): Promise<FtpFileReadResult> {
    return bridgeInvoke<FtpFileReadResult>('ftp.file.read', params)
  },

  /** 将文本写回远程 FTP 文件 */
  fileWrite(params: FtpFileWriteParams): Promise<FtpFileWriteResult> {
    return bridgeInvoke<FtpFileWriteResult>('ftp.file.write', params)
  },
} as const
