import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { mongodbConnectionNavStrategy } from '@/modules/mongodb/conn-nav-strategy'
import { mongoConnTreeProvider } from '@/modules/mongodb/conn-tree-provider'
import { registerForm } from '@/modules/mongodb/register-conn-form'

let registered = false

/** MongoDB 完整自注册。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('mongodb', mongodbConnectionNavStrategy)
  registerConnTreeProvider('mongodb', mongoConnTreeProvider)
}
