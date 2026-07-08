import type { FileProvider } from '@/modules/file-editor/types'

/** 全局 FileProvider 注册表（应用启动时注册 local / ftp 等） */
class FileProviderRegistry {
  private readonly providers = new Map<string, FileProvider>()

  register(provider: FileProvider): void {
    this.providers.set(provider.id, provider)
  }

  get(id: string): FileProvider | undefined {
    return this.providers.get(id)
  }

  require(id: string): FileProvider {
    const p = this.providers.get(id)
    if (!p) {
      throw new Error(`file provider not registered: ${id}`)
    }
    return p
  }
}

export const fileProviderRegistry = new FileProviderRegistry()
