import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'

export type SqlServerDdlDialogKind = 'create_database' | 'create_schema' | 'danger'

export type SqlServerDdlAction =
  | 'create_database'
  | 'create_schema'
  | 'truncate_table'
  | 'drop_table'

export interface SqlServerPendingDdlAction {
  conn: ConnItem
  action: SqlServerDdlAction
  profileId: string
  /** create_schema / 表级 DDL：目标库名 */
  database?: string
  schema?: string
  name: string
  title: string
  description: string
  kind: SqlServerDdlDialogKind
  azure?: boolean
  /** 成功后局部刷新的树路径；未提供则刷新连接根 */
  refreshPath?: ConnResourcePath
  refreshDeep?: boolean
  prunePaths?: ConnResourcePath[]
}

/**
 * SQL Server 树 DDL 对话框队列（由 SqlServerDdlActionHost 分发）。
 * 模块内状态，勿放入全局 `stores/`。
 */
export const useSqlServerDdlActionStore = defineStore('sqlserver-ddl-actions', () => {
  const pending = ref<SqlServerPendingDdlAction | null>(null)
  const busy = ref(false)

  function request(action: SqlServerPendingDdlAction): void {
    pending.value = action
  }

  function clear(): void {
    pending.value = null
    busy.value = false
  }

  return { pending, busy, request, clear }
})
