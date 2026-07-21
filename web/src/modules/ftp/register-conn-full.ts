import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { ftpConnectionNavStrategy } from '@/modules/ftp/conn-nav-strategy'
import { registerForm } from '@/modules/ftp/register-conn-form'

let registered = false

/** FTP 完整自注册。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('ftp', ftpConnectionNavStrategy)
}
