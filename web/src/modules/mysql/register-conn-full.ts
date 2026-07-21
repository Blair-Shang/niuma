import { defineAsyncComponent } from 'vue'
import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeActionHost, registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { mysqlConnectionNavStrategy } from '@/modules/mysql/conn-nav-strategy'
import { mysqlConnTreeProvider } from '@/modules/mysql/conn-tree-provider'
import { registerForm } from '@/modules/mysql/register-conn-form'
import { registerMysqlDataTasks } from '@/modules/mysql/data-tasks'

let registered = false

/** MySQL 完整自注册（表单 + 导航 + 树 + DDL ActionHost + 数据任务）。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('mysql', mysqlConnectionNavStrategy)
  registerConnTreeProvider('mysql', mysqlConnTreeProvider)
  registerConnTreeActionHost(
    defineAsyncComponent(() => import('@/modules/mysql/components/MysqlDdlActionHost.vue')),
  )
  registerMysqlDataTasks()
}
