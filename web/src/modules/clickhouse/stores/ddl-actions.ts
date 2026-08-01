import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'

export type ClickHouseDdlDialogKind = 'danger' | 'rename' | 'create_database'

export type ClickHouseDdlAction =
  | 'create_database'
  | 'drop_database'
  | 'drop_table'
  | 'drop_view'
  | 'drop_dictionary'
  | 'truncate_table'
  | 'rename_table'
  | 'reload_dictionary'

/** DDL 确认框共用的集群选项（建库 / 删库 / 删表 / 重命名等）。 */
export interface ClickHouseDatabaseCreateOptions {
  /** 可选 ON CLUSTER 集群名（可从连接配置预填，对话框内可改）。 */
  onCluster?: string
}

export interface ClickHousePendingDdlAction {
  conn: ConnItem
  refreshPath?: ConnResourcePath
  refreshDeep?: boolean
  prunePaths?: ConnResourcePath[]
  action: ClickHouseDdlAction
  profileId: string
  database?: string
  name: string
  title: string
  description: string
  kind?: ClickHouseDdlDialogKind
  newName?: string
  createOptions?: ClickHouseDatabaseCreateOptions
}

/**
 * ClickHouse 树 DDL 确认队列（由 ClickHouseDdlActionHost 按 kind 分发）。
 * 模块内状态，勿放入全局 `stores/`。
 */
export const useClickHouseDdlActionStore = defineStore('clickhouse-ddl-actions', () => {
  const pending = ref<ClickHousePendingDdlAction | null>(null)
  const busy = ref(false)

  function request(action: ClickHousePendingDdlAction): void {
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
