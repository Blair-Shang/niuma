import { defineAsyncComponent } from 'vue'
import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeActionHost, registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { kingbaseConnectionNavStrategy } from '@/modules/kingbase/conn-nav-strategy'
import { kingbaseConnTreeProvider } from '@/modules/kingbase/conn-tree-provider'
import { registerForm } from '@/modules/kingbase/register-conn-form'
import { registerKingbaseDataTasks } from '@/modules/kingbase/data-tasks'

let registered = false

/** Kingbase 完整自注册：表单 + 导航 + 对象树 + DDL 对话框宿主。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('kingbase', kingbaseConnectionNavStrategy)
  registerConnTreeProvider('kingbase', kingbaseConnTreeProvider)
  registerConnTreeActionHost(
    defineAsyncComponent(() => import('@/modules/kingbase/components/KingbaseDdlActionHost.vue')),
  )
  registerKingbaseDataTasks()
}
