import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'

export type MysqlDdlDialogKind = 'danger' | 'rename' | 'create_database'

export type MysqlDdlAction =
  | 'drop_database'
  | 'drop_table'
  | 'drop_view'
  | 'drop_procedure'
  | 'drop_function'
  | 'truncate_table'
  | 'rename_table'
  | 'create_database'

export interface MysqlDatabaseCreateOptions {
  charset: string
  collation: string
}

export interface MysqlPendingDdlAction {
  conn: ConnItem
  refreshPath?: ConnResourcePath
  refreshDeep?: boolean
  prunePaths?: ConnResourcePath[]
  action: MysqlDdlAction
  profileId: string
  database?: string
  name: string
  title: string
  description: string
  kind?: MysqlDdlDialogKind
  newName?: string
  createOptions?: MysqlDatabaseCreateOptions
}

/**
 * MySQL 树 DDL 确认队列（由 MysqlDdlActionHost 按 kind 分发）。
 * 模块内状态，勿放入全局 `stores/`。
 */
export const useMysqlDdlActionStore = defineStore('mysql-ddl-actions', () => {
  const pending = ref<MysqlPendingDdlAction | null>(null)
  const busy = ref(false)

  function request(action: MysqlPendingDdlAction): void {
    pending.value = {
      kind: 'danger',
      ...action,
    }
  }

  function clear(): void {
    pending.value = null
    busy.value = false
  }

  return { pending, busy, request, clear }
})
