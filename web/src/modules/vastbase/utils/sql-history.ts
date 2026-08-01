/**
 * Vastbase SQL 历史：兼容旧 key，底层走 database 公共实现。
 */
import {
  clearSqlHistory as clearShared,
  loadSqlHistory as loadShared,
  pushSqlHistory as pushShared,
  type SqlHistoryEntry,
} from '@/modules/database/utils/sql-history'

const STORAGE_PREFIX = 'niuma.vastbase.sqlHistory.' as const

export type VastSqlHistoryEntry = SqlHistoryEntry

export function loadSqlHistory(profileId: string): VastSqlHistoryEntry[] {
  return loadShared(STORAGE_PREFIX, profileId)
}

export function pushSqlHistory(
  profileId: string,
  sql: string,
  meta?: { durationMs?: number; rowCount?: number },
): VastSqlHistoryEntry[] {
  return pushShared(STORAGE_PREFIX, profileId, sql, meta)
}

export function clearSqlHistory(profileId: string): void {
  clearShared(STORAGE_PREFIX, profileId)
}
