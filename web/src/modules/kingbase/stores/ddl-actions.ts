import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { KingbaseDdlAction } from '@/api/types/kingbase'
import {
  dismissOtherDdlDialogs,
  registerDdlDialogClear,
} from '@/modules/ops/conn-tree/ddl-dialog-exclusive'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'

export type KingbaseDdlDialogKind =
  | 'danger'
  | 'rename'
  | 'create_database'
  | 'create_schema'
  | 'alter_owner'

export interface KingbaseDatabaseCreateOptions {
  owner: string
  encoding: string
  template: string
  lcCollate: string
  lcCtype: string
}

export interface KingbasePendingDdlAction {
  conn: ConnItem
  refreshPath?: ConnResourcePath
  refreshDeep?: boolean
  prunePaths?: ConnResourcePath[]
  action: KingbaseDdlAction
  profileId: string
  database?: string
  schema?: string
  name: string
  args?: string
  oid?: number
  title: string
  description: string
  kind?: KingbaseDdlDialogKind
  newName?: string
  createOptions?: KingbaseDatabaseCreateOptions
}

/**
 * Kingbase 树 DDL 确认队列（由 KingbaseDdlActionHost 按 kind 分发）。
 */
export const useKingbaseDdlActionStore = defineStore('kingbase-ddl-actions', () => {
  const pending = ref<KingbasePendingDdlAction | null>(null)
  const busy = ref(false)

  function request(action: KingbasePendingDdlAction): void {
    dismissOtherDdlDialogs('kingbase-ddl-actions')
    pending.value = {
      kind: 'danger',
      ...action,
    }
  }

  function clear(): void {
    pending.value = null
    busy.value = false
  }

  registerDdlDialogClear('kingbase-ddl-actions', clear)

  return { pending, busy, request, clear }
})
