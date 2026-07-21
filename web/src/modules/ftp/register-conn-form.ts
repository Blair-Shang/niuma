import { registerConnectionKind } from '@/modules/connection/registry'
import { registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { ftpConnectionFormAdapter } from '@/modules/ftp/connection-form-adapter'
import FtpConnectionFields from '@/modules/ftp/components/FtpConnectionFields.vue'

let registered = false

/**
 * 仅注册 FTP 连接表单（对话框路径）。
 * 字段组件与本模块同 chunk：ensureConnKindForm 完成后同步可用，避免对话框先矮后高跳动。
 */
export function registerForm(): void {
  if (registered) return
  registered = true
  registerConnectionFormAdapter('ftp', ftpConnectionFormAdapter)
  registerConnectionKind('ftp', {
    options: FtpConnectionFields,
    supportsTunnel: true,
  })
}
