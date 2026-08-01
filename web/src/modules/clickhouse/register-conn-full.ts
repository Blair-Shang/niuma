import { defineAsyncComponent } from 'vue'
import { registerConnectionNavStrategy } from '@/modules/ops/connection-nav/registry'
import { registerConnTreeActionHost, registerConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { clickhouseConnectionNavStrategy } from '@/modules/clickhouse/conn-nav-strategy'
import { clickhouseConnTreeProvider } from '@/modules/clickhouse/conn-tree-provider'
import { registerForm } from '@/modules/clickhouse/register-conn-form'
import { registerClickHouseDataTasks } from '@/modules/clickhouse/data-tasks'

let registered = false

/** ClickHouse 完整自注册（表单 + 导航 + 树 + DDL ActionHost + 数据任务）。 */
export function registerFull(): void {
  if (registered) return
  registered = true
  registerForm()
  registerConnectionNavStrategy('clickhouse', clickhouseConnectionNavStrategy)
  registerConnTreeProvider('clickhouse', clickhouseConnTreeProvider)
  registerConnTreeActionHost(
    defineAsyncComponent(() => import('@/modules/clickhouse/components/ClickHouseDdlActionHost.vue')),
  )
  registerClickHouseDataTasks()
}
