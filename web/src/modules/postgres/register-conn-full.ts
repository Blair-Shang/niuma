import { defineAsyncComponent } from 'vue'
import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeActionHost, registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { postgresConnectionNavStrategy } from '@/modules/postgres/conn-nav-strategy'
import { postgresConnTreeProvider } from '@/modules/postgres/conn-tree-provider'
import { registerForm } from '@/modules/postgres/register-conn-form'
import { registerPostgresDataTasks } from '@/modules/postgres/data-tasks'

let registered = false

/** Postgres 完整自注册：表单 + 导航 + 对象树 + DDL 对话框宿主。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('postgres', postgresConnectionNavStrategy)
  registerConnTreeProvider('postgres', postgresConnTreeProvider)
  registerConnTreeActionHost(
    defineAsyncComponent(() => import('@/modules/postgres/components/PostgresDdlActionHost.vue')),
  )
  registerPostgresDataTasks()
}
