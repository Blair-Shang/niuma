import { bridgeInvoke } from '@/api/client'
import type {
  FsDeleteParams,
  FsDeleteResult,
  FsHomeDirResult,
  FsListDirParams,
  FsListDirResult,
  FsMkdirParams,
  FsMkdirResult,
  FsReadTextParams,
  FsReadTextResult,
  FsRenameParams,
  FsRenameResult,
  FsShowInFolderParams,
  FsShowInFolderResult,
  FsWriteTextParams,
  FsWriteTextResult,
} from '@/api/types/fs'

/** 壳层本地文件系统（`shell.fs.*`） */
export const fsApi = {
  homeDir(): Promise<FsHomeDirResult> {
    return bridgeInvoke<FsHomeDirResult>('shell.fs.homeDir')
  },

  listDir(params: FsListDirParams): Promise<FsListDirResult> {
    return bridgeInvoke<FsListDirResult>('shell.fs.listDir', params)
  },

  showInFolder(params: FsShowInFolderParams): Promise<FsShowInFolderResult> {
    return bridgeInvoke<FsShowInFolderResult>('shell.fs.showInFolder', params)
  },

  mkdir(params: FsMkdirParams): Promise<FsMkdirResult> {
    return bridgeInvoke<FsMkdirResult>('shell.fs.mkdir', params)
  },

  rename(params: FsRenameParams): Promise<FsRenameResult> {
    return bridgeInvoke<FsRenameResult>('shell.fs.rename', params)
  },

  delete(params: FsDeleteParams): Promise<FsDeleteResult> {
    return bridgeInvoke<FsDeleteResult>('shell.fs.delete', params)
  },

  /** 读取本地文本文件（UTF-8 字节原样解码为字符串） */
  readText(params: FsReadTextParams): Promise<FsReadTextResult> {
    return bridgeInvoke<FsReadTextResult>('shell.fs.readText', params)
  },

  /** 将文本内容写回本地文件 */
  writeText(params: FsWriteTextParams): Promise<FsWriteTextResult> {
    return bridgeInvoke<FsWriteTextResult>('shell.fs.writeText', params)
  },
} as const
