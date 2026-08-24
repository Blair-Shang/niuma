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
  // Provider / 导航策略可重复覆盖，便于 HMR 后右键菜单拿到最新实现
  registerConnectionNavStrategy('oracle', oracleConnectionNavStrategy)
  registerConnTreeProvider('oracle', oracleConnTreeProvider)
  if (registered) return
  registered = true
  registerForm()
  registerOracleDataTasks()
  registerConnTreeActionHost(
    defineAsyncComponent(() => import('@/modules/oracle/components/OracleDdlActionHost.vue')),
  )
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    registerFull()
  })
}
