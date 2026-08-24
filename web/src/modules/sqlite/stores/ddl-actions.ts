import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  dismissOtherDdlDialogs,
  registerDdlDialogClear,
} from '@/modules/ops/conn-tree/ddl-dialog-exclusive'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'

export type SqliteDdlDialogKind = 'danger' | 'rename'

export type SqliteDdlAction =
  | 'drop_table'
  | 'drop_view'
  | 'drop_index'
  | 'drop_trigger'
  | 'empty_table'
  | 'rename_table'
  | 'detach_schema'

export interface SqlitePendingDdlAction {
  conn: ConnItem
  refreshPath?: ConnResourcePath
  refreshDeep?: boolean
  prunePaths?: ConnResourcePath[]
  action: SqliteDdlAction
  profileId: string
  schema: string
  name: string
  title: string
  description: string
  kind?: SqliteDdlDialogKind
  newName?: string
}

/**
 * SQLite 树 DDL 确认队列（由 SqliteDdlActionHost 分发）。
 * 模块内状态，勿放入全局 `stores/`；禁止复用其它库 DDL store。
 */
export const useSqliteDdlActionStore = defineStore('sqlite-ddl-actions', () => {
  const pending = ref<SqlitePendingDdlAction | null>(null)
  const busy = ref(false)

  function request(action: SqlitePendingDdlAction): void {
    dismissOtherDdlDialogs('sqlite-ddl-actions')
    pending.value = {
      kind: 'danger',
      ...action,
    }
  }

  function clear(): void {
    pending.value = null
    busy.value = false
  }

  registerDdlDialogClear('sqlite-ddl-actions', clear)

  return { pending, busy, request, clear }
})
