import { defineAsyncComponent } from 'vue'
import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeActionHost, registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { mongodbConnectionNavStrategy } from '@/modules/mongodb/conn-nav-strategy'
import { mongoConnTreeProvider } from '@/modules/mongodb/conn-tree-provider'
import { registerForm } from '@/modules/mongodb/register-conn-form'

let registered = false

/** MongoDB 完整自注册（表单 + 导航 + 树 + DDL ActionHost）。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('mongodb', mongodbConnectionNavStrategy)
  registerConnTreeProvider('mongodb', mongoConnTreeProvider)
  registerConnTreeActionHost(
    defineAsyncComponent(() => import('@/modules/mongodb/components/MongoDdlActionHost.vue')),
  )
}
