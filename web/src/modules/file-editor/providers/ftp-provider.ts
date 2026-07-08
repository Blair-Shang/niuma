import { ftpApi } from '@/api'
import type { FileProvider, FileProviderContext } from '@/modules/file-editor/types'

/** FTP 远程文件 Provider（ftp.file.read / file.write） */
export const ftpFileProvider: FileProvider = {
  id: 'ftp',

  canonicalKey(context: FileProviderContext): string {
    return `${String(context.sessionId ?? '')}:${String(context.path ?? '')}`
  },

  async read(context: FileProviderContext) {
    const sessionId = String(context.sessionId ?? '')
    const path = String(context.path ?? '')
    const result = await ftpApi.fileRead({ sessionId, path })
    const content = typeof result.content === 'string' ? result.content : ''
    const size = typeof result.size === 'number' ? result.size : content.length
    return { content, size }
  },

  async write(context: FileProviderContext, content: string) {
    const sessionId = String(context.sessionId ?? '')
    const path = String(context.path ?? '')
    await ftpApi.fileWrite({ sessionId, path, content })
  },

  sourceLabel(context: FileProviderContext): string {
    return `FTP · ${String(context.path ?? '')}`
  },
}
