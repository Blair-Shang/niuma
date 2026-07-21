/**
 * Vastbase 查询面板本地 SQL 历史（按 profile 隔离）。
 *
 * 存储位置：浏览器 localStorage
 * Key：`niuma.vastbase.sqlHistory.{profileId}`
 * 上限：40 条；同 SQL 去重后置顶。
 * 后续可迁到 nm_sql_history；先提供企业级「最近执行」体验。
 */

const STORAGE_PREFIX = 'niuma.vastbase.sqlHistory.'
const MAX_ENTRIES = 40

export interface VastSqlHistoryEntry {
  id: string
  sql: string
  at: number
  durationMs?: number
  rowCount?: number
}

function storageKey(profileId: string): string {
  return STORAGE_PREFIX + profileId
}

export function loadSqlHistory(profileId: string): VastSqlHistoryEntry[] {
  if (!profileId || typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(profileId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as VastSqlHistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function pushSqlHistory(
  profileId: string,
  sql: string,
  meta?: { durationMs?: number; rowCount?: number },
): VastSqlHistoryEntry[] {
  const trimmed = sql.trim()
  if (!profileId || !trimmed) return loadSqlHistory(profileId)

  const prev = loadSqlHistory(profileId).filter((e) => e.sql.trim() !== trimmed)
  const entry: VastSqlHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sql: trimmed,
    at: Date.now(),
    durationMs: meta?.durationMs,
    rowCount: meta?.rowCount,
  }
  const next = [entry, ...prev].slice(0, MAX_ENTRIES)
  try {
    localStorage.setItem(storageKey(profileId), JSON.stringify(next))
  } catch {
    // quota — ignore
  }
  return next
}

export function clearSqlHistory(profileId: string): void {
  if (!profileId || typeof localStorage === 'undefined') return
  localStorage.removeItem(storageKey(profileId))
}
