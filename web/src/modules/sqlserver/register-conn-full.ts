import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { sqlserverConnectionNavStrategy } from '@/modules/sqlserver/conn-nav-strategy'
import { registerForm } from '@/modules/sqlserver/register-conn-form'

let registered = false

/** SQL Server P0 自注册：表单 + 导航（无对象树）。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('sqlserver', sqlserverConnectionNavStrategy)
}
