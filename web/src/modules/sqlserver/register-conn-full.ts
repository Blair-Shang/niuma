import { defineAsyncComponent } from 'vue'
import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeActionHost, registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { sqlserverConnectionNavStrategy } from '@/modules/sqlserver/conn-nav-strategy'
import { sqlserverConnTreeProvider } from '@/modules/sqlserver/conn-tree-provider'
import { registerSqlServerDataTasks } from '@/modules/sqlserver/data-tasks'
import { registerForm } from '@/modules/sqlserver/register-conn-form'

let registered = false

/** SQL Server 自注册：表单 + 导航 + 对象树 + 新建库对话框。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('sqlserver', sqlserverConnectionNavStrategy)
  registerConnTreeProvider('sqlserver', sqlserverConnTreeProvider)
  registerConnTreeActionHost(
    defineAsyncComponent(() => import('@/modules/sqlserver/components/SqlServerDdlActionHost.vue')),
  )
  registerSqlServerDataTasks()
}
