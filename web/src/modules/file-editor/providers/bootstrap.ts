import { fileProviderRegistry } from '@/modules/file-editor/providers/registry'
import { ftpFileProvider } from '@/modules/file-editor/providers/ftp-provider'
import { localFileProvider } from '@/modules/file-editor/providers/local-provider'
import { sshSftpFileProvider } from '@/modules/file-editor/providers/ssh-sftp-provider'

/** 注册内置 FileProvider（应用入口调用一次） */
export function registerBuiltinFileProviders(): void {
  fileProviderRegistry.register(localFileProvider)
  fileProviderRegistry.register(ftpFileProvider)
  fileProviderRegistry.register(sshSftpFileProvider)
}
