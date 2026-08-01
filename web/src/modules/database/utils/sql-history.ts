/**
 * 方言无关的本地 SQL 执行历史（按 profile 隔离）。
 *
 * Key：`{storagePrefix}{profileId}`（例：`niuma.mysql.sqlHistory.`）
 * 上限：40 条；同 SQL 去重后置顶。
 * 后续可迁 nm_sql_history；先提供企业级「最近执行」体验。
 */

const MAX_ENTRIES = 40

export interface SqlHistoryEntry {
  id: string
  sql: string
  at: number
  durationMs?: number
  rowCount?: number
}

export type SqlHistoryStoragePrefix =
  | 'niuma.mysql.sqlHistory.'
  | 'niuma.vastbase.sqlHistory.'
  | 'niuma.postgresql.sqlHistory.'
  | 'niuma.oracle.sqlHistory.'
  | (string & {})

function storageKey(prefix: string, profileId: string): string {
  return prefix + profileId
}

export function loadSqlHistory(
  prefix: SqlHistoryStoragePrefix,
  profileId: string,
): SqlHistoryEntry[] {
  if (!profileId || typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(prefix, profileId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as SqlHistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function pushSqlHistory(
  prefix: SqlHistoryStoragePrefix,
  profileId: string,
  sql: string,
  meta?: { durationMs?: number; rowCount?: number },
): SqlHistoryEntry[] {
  const trimmed = sql.trim()
  if (!profileId || !trimmed) return loadSqlHistory(prefix, profileId)

  const prev = loadSqlHistory(prefix, profileId).filter((e) => e.sql.trim() !== trimmed)
  const entry: SqlHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sql: trimmed,
    at: Date.now(),
    durationMs: meta?.durationMs,
    rowCount: meta?.rowCount,
  }
  const next = [entry, ...prev].slice(0, MAX_ENTRIES)
  try {
    localStorage.setItem(storageKey(prefix, profileId), JSON.stringify(next))
  } catch {
    // quota — ignore
  }
  return next
}

export function clearSqlHistory(prefix: SqlHistoryStoragePrefix, profileId: string): void {
  if (!profileId || typeof localStorage === 'undefined') return
  localStorage.removeItem(storageKey(prefix, profileId))
}

export function previewSqlHistory(sql: string, maxLen = 72): string {
  const preview = sql.replace(/\s+/g, ' ').slice(0, maxLen)
  return sql.length > maxLen ? `${preview}…` : preview
}
