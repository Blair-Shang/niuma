import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ConnItem } from '@/modules/ops/types'

export interface SqliteDbPropertiesRequest {
  conn: ConnItem
  profileId: string
  sessionId?: string | null
  title: string
}

/**
 * SQLite 库属性对话框状态（PRAGMA 只读概览）。
 * 模块内状态，勿放入全局 `stores/`。
 */
export const useSqliteDbPropertiesStore = defineStore('sqlite-db-properties', () => {
  const pending = ref<SqliteDbPropertiesRequest | null>(null)

  function request(req: SqliteDbPropertiesRequest): void {
    pending.value = req
  }

  function clear(): void {
    pending.value = null
  }

  return { pending, request, clear }
})
