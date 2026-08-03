import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ConnItem } from '@/modules/ops/types'

/** 需确认后执行的维护项（会改写/重建文件或索引）。 */
export type SqliteMaintainConfirmAction = 'vacuum' | 'wal_checkpoint' | 'reindex'

/** 直接运行并展示汇总的检查项。 */
export type SqliteMaintainCheckAction = 'integrity' | 'quick_check'

export type SqliteMaintainAction = SqliteMaintainConfirmAction | SqliteMaintainCheckAction | 'analyze'

export type SqliteMaintainDialogKind = 'confirm' | 'check'

export interface SqlitePendingMaintainAction {
  conn: ConnItem
  profileId: string
  /** 目标库别名；main / 空表示默认库。 */
  schema: string
  /** 表级 ANALYZE / REINDEX 时可选。 */
  table?: string
  action: Exclude<SqliteMaintainAction, 'analyze'>
  title: string
  description: string
  kind: SqliteMaintainDialogKind
}

/**
 * SQLite 维护 / 诊断对话框队列（确认执行 + 完整性检查结果）。
 * 模块内状态，勿放入全局 `stores/`。
 */
export const useSqliteMaintainActionStore = defineStore('sqlite-maintain-actions', () => {
  const pending = ref<SqlitePendingMaintainAction | null>(null)
  const busy = ref(false)

  function request(action: SqlitePendingMaintainAction): void {
    pending.value = action
  }

  function clear(): void {
    pending.value = null
    busy.value = false
  }

  return { pending, busy, request, clear }
})
