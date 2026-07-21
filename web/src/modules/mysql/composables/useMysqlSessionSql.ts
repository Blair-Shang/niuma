/**
 * MySQL 树 DDL / SHOW CREATE：复用已有 session，否则短暂 open/close。
 */
import { mysqlApi } from '@/api'
import type { MysqlQueryExecResult } from '@/api/types/mysql'
import { useSessionRegistry } from '@/stores/session-registry'

export async function withMysqlSession<T>(
  profileId: string,
  fn: (sessionId: string) => Promise<T>,
): Promise<T> {
  const existing = useSessionRegistry().getSessionIdForProfile(profileId, 'mysql')
  if (existing) {
    return fn(existing)
  }
  const opened = await mysqlApi.sessionOpen({ profileId })
  try {
    return await fn(opened.sessionId)
  } finally {
    await mysqlApi.sessionClose({ sessionId: opened.sessionId }).catch(() => undefined)
  }
}

export async function execMysqlSql(
  profileId: string,
  sql: string,
  database?: string,
): Promise<MysqlQueryExecResult> {
  return withMysqlSession(profileId, async (sessionId) => {
    const result = await mysqlApi.queryExec({
      sessionId,
      database,
      sql,
      limit: 50,
    })
    if (result.resultSetId) {
      await mysqlApi
        .queryClose({ sessionId, resultSetId: result.resultSetId })
        .catch(() => undefined)
    }
    return result
  })
}

/** 从 SHOW CREATE 结果取 DDL 文本（通常为第 2 列）。 */
export function extractShowCreateDdl(result: MysqlQueryExecResult): string | null {
  const row = result.rows?.[0]
  if (!Array.isArray(row) || row.length < 2) return null
  const v = row[1]
  if (typeof v === 'string' && v.trim()) return v
  if (v != null && String(v).trim()) return String(v)
  return null
}
