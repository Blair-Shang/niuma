import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { sshConnectionNavStrategy } from '@/modules/ssh/conn-nav-strategy'
import { registerForm } from '@/modules/ssh/register-conn-form'

let registered = false

/** SSH 完整自注册。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('ssh', sshConnectionNavStrategy)
}
