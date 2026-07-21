import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { sshConnectionFormAdapter } from '@/modules/ssh/connection-form-adapter'
import SshConnectionFields from '@/modules/ssh/components/SshConnectionFields.vue'
import SshConnectionOptionsFields from '@/modules/ssh/components/SshConnectionOptionsFields.vue'

let registered = false

/**
 * 仅注册 SSH 连接表单（对话框路径）。
 * 字段组件与本模块同 chunk：ensureConnKindForm 完成后同步可用，避免对话框先矮后高跳动。
 */
export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('ssh', sshConnectionFormAdapter)
  registerConnectionKind('ssh', {
    credentialSection: SshConnectionFields,
    options: SshConnectionOptionsFields,
    supportsTunnel: true,
  })
}
