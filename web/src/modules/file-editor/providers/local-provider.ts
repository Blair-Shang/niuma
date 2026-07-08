import { fsApi } from '@/api'
import type { FileProvider, FileProviderContext } from '@/modules/file-editor/types'

/** 本地文件 Provider（shell.fs.readText / writeText） */
export const localFileProvider: FileProvider = {
  id: 'local',

  canonicalKey(context: FileProviderContext): string {
    return String(context.path ?? '')
  },

  async read(context: FileProviderContext) {
    const path = String(context.path ?? '')
    const result = await fsApi.readText({ path })
    const content = typeof result.content === 'string' ? result.content : ''
    return { content, size: content.length }
  },

  async write(context: FileProviderContext, content: string) {
    const path = String(context.path ?? '')
    await fsApi.writeText({ path, content })
  },

  sourceLabel(context: FileProviderContext): string {
    return String(context.path ?? '')
  },
}
