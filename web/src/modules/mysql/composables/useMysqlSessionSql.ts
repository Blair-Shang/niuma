/**
 * MySQL 树 DDL / SHOW CREATE：始终短暂 open/close。
 * 不复用查询 Tab 的 per_tab 会话，避免卷入对方未提交事务。
 */
import { mysqlApi } from '@/api'
import type { MysqlQueryExecResult } from '@/api/types/mysql'

export async function withMysqlSession<T>(
  profileId: string,
  fn: (sessionId: string) => Promise<T>,
  database?: string,
): Promise<T> {
  const opened = await mysqlApi.sessionOpen({
    profileId,
    database: database?.trim() || undefined,
  })
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
  return withMysqlSession(
    profileId,
    async (sessionId) => {
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
    },
    database,
  )
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
