import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'

export type OracleDdlDialogKind = 'danger' | 'rename'

export type OracleDdlAction =
  | 'drop_table'
  | 'drop_view'
  | 'drop_procedure'
  | 'drop_function'
  | 'drop_sequence'
  | 'drop_package'
  | 'truncate_table'
  | 'rename_table'
  | 'rename_view'
  | 'rename_sequence'

export interface OraclePendingDdlAction {
  conn: ConnItem
  refreshPath?: ConnResourcePath
  refreshDeep?: boolean
  prunePaths?: ConnResourcePath[]
  action: OracleDdlAction
  profileId: string
  schema?: string
  name: string
  title: string
  description: string
  kind?: OracleDdlDialogKind
  newName?: string
}

/**
 * Oracle 树 DDL 确认队列（由 OracleDdlActionHost 按 kind 分发）。
 * 模块内状态，勿放入全局 `stores/`。
 */
export const useOracleDdlActionStore = defineStore('oracle-ddl-actions', () => {
  const pending = ref<OraclePendingDdlAction | null>(null)
  const busy = ref(false)

  function request(action: OraclePendingDdlAction): void {
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
