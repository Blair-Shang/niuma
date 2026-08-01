import { sqliteApi } from '@/api/sqlite'
import type { SqliteQueryExecResult } from '@/api/types/sqlite'
import { useSessionRegistry } from '@/stores/session-registry'

/** 临时打开会话执行回调，结束后关闭（用于树/IO 向导无现成 sessionId 的场景）。 */
export async function withSqliteSession<T>(
  profileId: string,
  fn: (sessionId: string) => Promise<T>,
): Promise<T> {
  const { sessionId } = await sqliteApi.sessionOpen({ profileId })
  try {
    return await fn(sessionId)
  } finally {
    try {
      await sqliteApi.sessionClose({ sessionId })
    } catch {
      /* ignore */
    }
  }
}

/**
 * 优先复用 Session Registry 中已打开的 sqlite 会话（DETACH / 运行时 ATTACH 可见），
 * 否则短生命周期 session.open。
 */
export async function withPreferredSqliteSession<T>(
  profileId: string,
  fn: (sessionId: string) => Promise<T>,
): Promise<T> {
  const existing = useSessionRegistry().getSessionIdForProfile(profileId, 'sqlite')
  if (existing) {
    return fn(existing)
  }
  return withSqliteSession(profileId, fn)
}

/** 短生命周期会话执行 DDL / 维护语句。 */
export async function execSqliteSql(
  profileId: string,
  sql: string,
  schema?: string,
): Promise<SqliteQueryExecResult> {
  return withSqliteSession(profileId, async (sessionId) => {
    const result = await sqliteApi.queryExec({
      sessionId,
      schema,
      sql,
      limit: 50,
    })
    if (result.resultSetId) {
      await sqliteApi
        .queryClose({ sessionId, resultSetId: result.resultSetId })
        .catch(() => undefined)
    }
    return result
  })
}
