import { computed, ref, watch, type Ref } from 'vue'
import {
  clearSqlHistory,
  loadSqlHistory,
  previewSqlHistory,
  pushSqlHistory,
  type SqlHistoryEntry,
  type SqlHistoryStoragePrefix,
} from '../utils/sql-history'

export function useSqlQueryHistory(options: {
  profileId: () => string | undefined
  storagePrefix: SqlHistoryStoragePrefix
  sqlText: Ref<string>
  /** 历史弹层最多展示条数 */
  visibleLimit?: number
}) {
  const history = ref<SqlHistoryEntry[]>([])
  const historyOpen = ref(false)
  const visibleLimit = options.visibleLimit ?? 20

  const historyEntries = computed(() => history.value.slice(0, visibleLimit))

  function refreshHistory(): void {
    const id = options.profileId()
    history.value = id ? loadSqlHistory(options.storagePrefix, id) : []
  }

  function rememberSql(
    sql: string,
    meta?: { durationMs?: number; rowCount?: number },
  ): void {
    const id = options.profileId()
    if (!id) return
    history.value = pushSqlHistory(options.storagePrefix, id, sql, meta)
  }

  function onHistoryPick(id: string): void {
    historyOpen.value = false
    const profileId = options.profileId()
    if (id === '__clear') {
      if (profileId) clearSqlHistory(options.storagePrefix, profileId)
      refreshHistory()
      return
    }
    const entry = history.value.find((e) => e.id === id)
    if (entry) options.sqlText.value = entry.sql
  }

  function historyPreview(sql: string): string {
    return previewSqlHistory(sql)
  }

  watch(
    () => options.profileId(),
    () => refreshHistory(),
    { immediate: true },
  )

  return {
    history,
    historyOpen,
    historyEntries,
    refreshHistory,
    rememberSql,
    onHistoryPick,
    historyPreview,
  }
}
