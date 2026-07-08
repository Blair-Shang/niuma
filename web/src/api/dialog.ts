import { bridgeInvoke } from '@/api/client'
import type {
  DialogFileParams,
  DialogFileResult,
  DialogOpenFolderParams,
  DialogOpenFolderResult,
} from '@/api/types/dialog'

/** 壳层原生对话框（`shell.dialog.*`） */
export const dialogApi = {
  /** Windows 原生文件夹选择（FILE_DIALOG_OPEN_FOLDER） */
  openFolder(params: DialogOpenFolderParams = {}): Promise<DialogOpenFolderResult> {
    return bridgeInvoke<DialogOpenFolderResult>('shell.dialog.openFolder', params)
  },

  openFile(params: DialogFileParams = {}): Promise<DialogFileResult> {
    return bridgeInvoke<DialogFileResult>('shell.dialog.openFile', params)
  },

  saveFile(params: DialogFileParams = {}): Promise<DialogFileResult> {
    return bridgeInvoke<DialogFileResult>('shell.dialog.saveFile', params)
  },
} as const
