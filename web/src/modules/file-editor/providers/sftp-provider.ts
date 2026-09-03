import { sftpApi } from '@/api'
import type { FileProvider, FileProviderContext } from '@/modules/file-editor/types'

/** 独立 SFTP 远程文件 Provider（sftp.file.read / sftp.file.write） */
export const sftpFileProvider: FileProvider = {
  id: 'sftp',

  canonicalKey(context: FileProviderContext): string {
    return `${String(context.sessionId ?? '')}:${String(context.path ?? '')}`
  },

  async read(context: FileProviderContext) {
    const sessionId = String(context.sessionId ?? '')
    const path = String(context.path ?? '')
    const result = await sftpApi.fileRead({ sessionId, path })
    const content = typeof result.content === 'string' ? result.content : ''
    const size = typeof result.size === 'number' ? result.size : content.length
    return { content, size }
  },

  async write(context: FileProviderContext, content: string) {
    const sessionId = String(context.sessionId ?? '')
    const path = String(context.path ?? '')
    await sftpApi.fileWrite({ sessionId, path, content })
  },

  sourceLabel(context: FileProviderContext): string {
    return `SFTP · ${String(context.path ?? '')}`
  },
}
