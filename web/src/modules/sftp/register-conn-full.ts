import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { sftpConnectionNavStrategy } from '@/modules/sftp/conn-nav-strategy'
import { registerForm } from '@/modules/sftp/register-conn-form'

let registered = false

/** SFTP 完整自注册。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('sftp', sftpConnectionNavStrategy)
}
