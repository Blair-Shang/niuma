import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  dismissOtherDdlDialogs,
  registerDdlDialogClear,
} from '@/modules/ops/conn-tree/ddl-dialog-exclusive'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'

export type MongoDdlDialogKind = 'rename' | 'create_database'

export type MongoDdlAction = 'create_database' | 'rename_database' | 'rename_collection'

/** 新建数据库时必须同时给出首个集合名（MongoDB 无空库）。 */
export interface MongoDatabaseCreateOptions {
  collection: string
}

export interface MongoPendingDdlAction {
  conn: ConnItem
  refreshPath?: ConnResourcePath
  refreshDeep?: boolean
  prunePaths?: ConnResourcePath[]
  action: MongoDdlAction
  profileId: string
  database?: string
  name: string
  title: string
  description: string
  kind?: MongoDdlDialogKind
  newName?: string
  createOptions?: MongoDatabaseCreateOptions
}

/**
 * MongoDB 树 DDL 确认队列（由 MongoDdlActionHost 按 kind 分发）。
 * 模块内状态，勿放入全局 `stores/`。
 */
export const useMongoDdlActionStore = defineStore('mongodb-ddl-actions', () => {
  const pending = ref<MongoPendingDdlAction | null>(null)
  const busy = ref(false)

  function request(action: MongoPendingDdlAction): void {
    dismissOtherDdlDialogs('mongodb-ddl-actions')
    pending.value = {
      kind: 'rename',
      ...action,
    }
  }

  function clear(): void {
    pending.value = null
    busy.value = false
  }

  registerDdlDialogClear('mongodb-ddl-actions', clear)

  return { pending, busy, request, clear }
})
