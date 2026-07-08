/** 本地目录项（`shell.fs.listDir`） */
export interface LocalEntry {
  name: string
  kind: 'file' | 'dir'
  size: number
}

/** `shell.fs.homeDir` 返回 */
export interface FsHomeDirResult {
  path: string
}

/** `shell.fs.listDir` 入参 */
export interface FsListDirParams {
  path: string
}

/** `shell.fs.listDir` 返回 */
export interface FsListDirResult {
  path: string
  entries: LocalEntry[]
}

/** `shell.fs.showInFolder` 入参 */
export interface FsShowInFolderParams {
  path: string
}

/** `shell.fs.showInFolder` 返回 */
export interface FsShowInFolderResult {
  shown: boolean
}

/** `shell.fs.mkdir` 入参 */
export interface FsMkdirParams {
  path: string
}

/** `shell.fs.mkdir` 返回 */
export interface FsMkdirResult {
  created: boolean
}

/** `shell.fs.rename` 入参 */
export interface FsRenameParams {
  fromPath: string
  toPath: string
}

/** `shell.fs.rename` 返回 */
export interface FsRenameResult {
  renamed: boolean
}

/** `shell.fs.delete` 入参 */
export interface FsDeleteParams {
  path: string
}

/** `shell.fs.delete` 返回 */
export interface FsDeleteResult {
  deleted: boolean
}

/** `shell.fs.readText` 入参 */
export interface FsReadTextParams {
  path: string
}

/** `shell.fs.readText` 返回 */
export interface FsReadTextResult {
  path: string
  content: string
}

/** `shell.fs.writeText` 入参 */
export interface FsWriteTextParams {
  path: string
  content: string
}

/** `shell.fs.writeText` 返回 */
export interface FsWriteTextResult {
  written: boolean
}
