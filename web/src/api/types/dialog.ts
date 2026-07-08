/** `shell.dialog.openFolder` 入参 */
export interface DialogOpenFolderParams {
  title?: string
  defaultPath?: string
  /** Windows 原生文件夹对话框确认按钮文案 */
  okButtonLabel?: string
}

/** `shell.dialog.openFolder` 返回 */
export interface DialogOpenFolderResult {
  canceled: boolean
  filePaths: string[]
}

/** `shell.dialog.openFile` / `shell.dialog.saveFile` 入参 */
export interface DialogFileParams {
  title?: string
  defaultPath?: string
  multiple?: boolean
  accept?: string[]
}

/** `shell.dialog.openFile` / `shell.dialog.saveFile` 返回 */
export interface DialogFileResult {
  canceled: boolean
  filePaths: string[]
}
