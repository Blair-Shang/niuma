/**
 * Oracle 树 DDL / meta：始终短暂 open/close。
 * 不复用查询 Tab 的 per_tab 会话，避免卷入对方未提交事务。
 */
import { oracleApi } from '@/api/oracle'
import type { OracleQueryExecResult } from '@/api/types/oracle'

export async function withOracleSession<T>(
  profileId: string,
  fn: (sessionId: string) => Promise<T>,
): Promise<T> {
  const opened = await oracleApi.sessionOpen({ profileId })
  try {
    return await fn(opened.sessionId)
  } finally {
    await oracleApi.sessionClose({ sessionId: opened.sessionId }).catch(() => undefined)
  }
}

export async function execOracleSql(
  profileId: string,
  sql: string,
  schema?: string,
): Promise<OracleQueryExecResult> {
  return withOracleSession(profileId, async (sessionId) => {
    const result = await oracleApi.queryExec({
      sessionId,
      schema: schema?.trim() || undefined,
      sql,
      limit: 50,
    })
    if (result.resultSetId) {
      await oracleApi
        .queryClose({ sessionId, resultSetId: result.resultSetId })
        .catch(() => undefined)
    }
    return result
  })
}
