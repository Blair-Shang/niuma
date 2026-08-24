/**
 * SQL Server 树 DDL：短暂 open/close，不复用查询 Tab 会话。
 */
import { sqlserverApi } from '@/api/sqlserver'
import type { SqlServerQueryExecResult } from '@/api/types/sqlserver'
import { splitSqlTexts } from '@/modules/sql-editor/split/sql-statement-splitter'

const DDL_TIMEOUT_MS = 180_000

export async function withSqlServerSession<T>(
  profileId: string,
  fn: (sessionId: string) => Promise<T>,
  database?: string,
): Promise<T> {
  const opened = await sqlserverApi.sessionOpen({
    profileId,
    database: database?.trim() || undefined,
  })
  try {
    return await fn(opened.sessionId)
  } finally {
    await sqlserverApi.sessionClose({ sessionId: opened.sessionId }).catch(() => undefined)
  }
}

export async function execSqlServerSql(
  profileId: string,
  sql: string,
  database?: string,
): Promise<SqlServerQueryExecResult | undefined> {
  return withSqlServerSession(
    profileId,
    async (sessionId) => {
      const batches = splitSqlTexts(sql, 'sqlserver').filter((b) => b.trim())
      if (batches.length === 0) {
        throw new Error('sql required')
      }
      let last: SqlServerQueryExecResult | undefined
      for (const batch of batches) {
        last = await sqlserverApi.queryExec({
          sessionId,
          database,
          sql: batch,
          limit: 50,
          timeoutMs: DDL_TIMEOUT_MS,
        })
        if (last.resultSetId) {
          await sqlserverApi
            .queryClose({ sessionId, resultSetId: last.resultSetId })
            .catch(() => undefined)
        }
      }
      return last
    },
    database,
  )
}

export function firstCell(
  result: SqlServerQueryExecResult | undefined,
  column: string,
): string {
  if (!result?.columns || !result.rows?.length) return ''
  const idx = result.columns.findIndex((c) => c.name.toLowerCase() === column.toLowerCase())
  if (idx < 0) return ''
  const value = result.rows[0]?.[idx]
  return value == null ? '' : String(value)
}

export function columnValues(result: SqlServerQueryExecResult | undefined, column: string): string[] {
  if (!result?.columns || !result.rows?.length) return []
  const idx = result.columns.findIndex((c) => c.name.toLowerCase() === column.toLowerCase())
  if (idx < 0) return []
  return result.rows
    .map((row) => row[idx])
    .filter((v) => v != null && String(v).trim())
    .map(String)
}
