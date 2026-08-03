import { defineAsyncComponent } from 'vue'
import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeActionHost, registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { oracleConnectionNavStrategy } from '@/modules/oracle/conn-nav-strategy'
import { oracleConnTreeProvider } from '@/modules/oracle/conn-tree-provider'
import { registerOracleDataTasks } from '@/modules/oracle/data-tasks'
import { registerForm } from '@/modules/oracle/register-conn-form'

let registered = false

/** Oracle 完整自注册（表单 + 导航 + 树 + DDL ActionHost + 数据任务）。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerOracleDataTasks()
  registerConnectionNavStrategy('oracle', oracleConnectionNavStrategy)
  registerConnTreeProvider('oracle', oracleConnTreeProvider)
  registerConnTreeActionHost(
    defineAsyncComponent(() => import('@/modules/oracle/components/OracleDdlActionHost.vue')),
  )
}
