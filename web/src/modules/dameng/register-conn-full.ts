import { defineAsyncComponent } from 'vue'
import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeActionHost, registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { damengConnectionNavStrategy } from '@/modules/dameng/conn-nav-strategy'
import { damengConnTreeProvider } from '@/modules/dameng/conn-tree-provider'
import { registerDamengDataTasks } from '@/modules/dameng/data-tasks'
import { registerForm } from '@/modules/dameng/register-conn-form'

let registered = false

export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('dameng', damengConnectionNavStrategy)
  registerConnTreeProvider('dameng', damengConnTreeProvider)
  registerConnTreeActionHost(
    defineAsyncComponent(() => import('@/modules/dameng/components/DamengDdlActionHost.vue')),
  )
  registerDamengDataTasks()
}
