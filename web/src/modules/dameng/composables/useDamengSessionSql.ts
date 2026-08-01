/**
 * 达梦树 DDL / 元数据：始终短暂 open/close。
 * 不复用查询 Tab 会话，避免卷入对方未提交事务。
 */
import { damengApi } from '@/api/dameng'
import type { DamengQueryExecResult } from '@/api/types/dameng'

export async function withDamengSession<T>(
  profileId: string,
  fn: (sessionId: string) => Promise<T>,
): Promise<T> {
  const opened = await damengApi.sessionOpen({ profileId })
  try {
    return await fn(opened.sessionId)
  } finally {
    await damengApi.sessionClose({ sessionId: opened.sessionId }).catch(() => undefined)
  }
}

export async function execDamengSql(
  profileId: string,
  sql: string,
  schema?: string,
): Promise<DamengQueryExecResult> {
  return withDamengSession(profileId, async (sessionId) => {
    const result = await damengApi.queryExec({
      sessionId,
      schema,
      sql,
      limit: 50,
    })
    if (result.resultSetId) {
      await damengApi
        .queryClose({ sessionId, resultSetId: result.resultSetId })
        .catch(() => undefined)
    }
    return result
  })
}
