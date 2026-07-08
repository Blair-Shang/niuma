import type { RsCodeEditorLanguage } from '@niuma/ui'
import type { FileOpenSpec } from '@/api/types/file-editor'

/** Provider 私有上下文 */
export type FileProviderContext = Record<string, unknown>

/** Provider 读取结果 */
export interface FileReadResult {
  content: string
  size: number
}

/** 文件读写适配器（按来源注册：local / ftp / …） */
export interface FileProvider {
  readonly id: string
  canonicalKey(context: FileProviderContext): string
  read(context: FileProviderContext): Promise<FileReadResult>
  write(context: FileProviderContext, content: string): Promise<void>
  sourceLabel?(context: FileProviderContext): string
}

/** 工作台内单个文档 Tab 的状态 */
export interface FileDocument {
  docId: string
  spec: FileOpenSpec
  label: string
  readonly: boolean
  content: string
  savedContent: string
  language: RsCodeEditorLanguage
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  error?: string
  size?: number
  sourceLabel?: string
}
