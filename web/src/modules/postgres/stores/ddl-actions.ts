import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PostgresDdlAction } from '@/api/types/postgres'
import {
  dismissOtherDdlDialogs,
  registerDdlDialogClear,
} from '@/modules/ops/conn-tree/ddl-dialog-exclusive'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'

export type PostgresDdlDialogKind =
  | 'danger'
  | 'rename'
  | 'create_database'
  | 'create_schema'
  | 'alter_owner'
  | 'grant'

export interface PostgresDatabaseCreateOptions {
  owner: string
  encoding: string
  template: string
  tablespace?: string
  connectionLimit?: number
  lcCollate: string
  lcCtype: string
}

export interface PostgresPendingDdlAction {
  conn: ConnItem
  refreshPath?: ConnResourcePath
  refreshDeep?: boolean
  prunePaths?: ConnResourcePath[]
  action: PostgresDdlAction
  profileId: string
  database?: string
  schema?: string
  name: string
  args?: string
  oid?: number
  title: string
  description: string
  kind?: PostgresDdlDialogKind
  newName?: string
  createOptions?: PostgresDatabaseCreateOptions
  table?: string
  objectKind?: string
}

/**
 * Postgres 树 DDL 确认队列（由 PostgresDdlActionHost 按 kind 分发）。
 */
export const usePostgresDdlActionStore = defineStore('postgres-ddl-actions', () => {
  const pending = ref<PostgresPendingDdlAction | null>(null)
  const busy = ref(false)

  function request(action: PostgresPendingDdlAction): void {
    dismissOtherDdlDialogs('postgres-ddl-actions')
    pending.value = {
      kind: 'danger',
      ...action,
    }
  }

  function clear(): void {
    pending.value = null
    busy.value = false
  }

  registerDdlDialogClear('postgres-ddl-actions', clear)

  return { pending, busy, request, clear }
})
