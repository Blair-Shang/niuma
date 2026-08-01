import { defineAsyncComponent } from 'vue'
import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeActionHost, registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { sqliteConnectionNavStrategy } from '@/modules/sqlite/conn-nav-strategy'
import { sqliteConnTreeProvider } from '@/modules/sqlite/conn-tree-provider'
import { registerSqliteDataTasks } from '@/modules/sqlite/data-tasks'
import { registerForm } from '@/modules/sqlite/register-conn-form'

let registered = false

/** SQLite 完整自注册（表单 + 导航 + 树 + DDL ActionHost + 数据任务）。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('sqlite', sqliteConnectionNavStrategy)
  registerConnTreeProvider('sqlite', sqliteConnTreeProvider)
  registerConnTreeActionHost(
    defineAsyncComponent(() => import('@/modules/sqlite/components/SqliteDdlActionHost.vue')),
  )
  registerSqliteDataTasks()
}
