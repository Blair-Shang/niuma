import { sshApi } from '@/api'
import type { FileProvider, FileProviderContext } from '@/modules/file-editor/types'

/** SSH SFTP 远程文件 Provider（ssh.sftp.file.read / ssh.sftp.file.write） */
export const sshSftpFileProvider: FileProvider = {
  id: 'ssh-sftp',

  canonicalKey(context: FileProviderContext): string {
    return `${String(context.sessionId ?? '')}:${String(context.path ?? '')}`
  },

  async read(context: FileProviderContext) {
    const sessionId = String(context.sessionId ?? '')
    const path = String(context.path ?? '')
    const result = await sshApi.sftpFileRead({ sessionId, path })
    const content = typeof result.content === 'string' ? result.content : ''
    const size = typeof result.size === 'number' ? result.size : content.length
    return { content, size }
  },

  async write(context: FileProviderContext, content: string) {
    const sessionId = String(context.sessionId ?? '')
    const path = String(context.path ?? '')
    await sshApi.sftpFileWrite({ sessionId, path, content })
  },

  sourceLabel(context: FileProviderContext): string {
    return `SSH · ${String(context.path ?? '')}`
  },
}
