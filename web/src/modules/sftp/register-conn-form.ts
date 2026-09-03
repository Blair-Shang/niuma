import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { sftpConnectionFormAdapter } from '@/modules/sftp/connection-form-adapter'
import SshConnectionFields from '@/modules/ssh/components/SshConnectionFields.vue'
import SshConnectionOptionsFields from '@/modules/ssh/components/SshConnectionOptionsFields.vue'

let registered = false

/**
 * 仅注册 SFTP 连接表单（对话框路径）。
 * 认证字段复用 SSH（密码 / 私钥 / 私钥文件）。
 */
export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('sftp', sftpConnectionFormAdapter)
  registerConnectionKind('sftp', {
    credentialSection: SshConnectionFields,
    options: SshConnectionOptionsFields,
    supportsTunnel: true,
  })
}
