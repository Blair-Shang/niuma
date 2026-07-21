import { defineAsyncComponent } from 'vue'
import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeActionHost, registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { vastbaseConnectionNavStrategy } from '@/modules/vastbase/conn-nav-strategy'
import { vastbaseConnTreeProvider } from '@/modules/vastbase/conn-tree-provider'
import { registerVastbaseDataTasks } from '@/modules/vastbase/data-tasks'
import { registerForm } from '@/modules/vastbase/register-conn-form'

let registered = false

/** Vastbase 完整自注册。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('vastbase', vastbaseConnectionNavStrategy)
  registerConnTreeProvider('vastbase', vastbaseConnTreeProvider)
  registerConnTreeActionHost(
    defineAsyncComponent(() => import('@/modules/vastbase/components/VastDdlActionHost.vue')),
  )
  registerVastbaseDataTasks()
}
