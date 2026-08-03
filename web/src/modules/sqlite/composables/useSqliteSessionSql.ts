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

async function runExec(
  sessionId: string,
  sql: string,
  schema: string | undefined,
  limit: number,
): Promise<SqliteQueryExecResult> {
  const result = await sqliteApi.queryExec({
    sessionId,
    schema,
    sql,
    limit,
  })
  if (result.resultSetId) {
    await sqliteApi
      .queryClose({ sessionId, resultSetId: result.resultSetId })
      .catch(() => undefined)
  }
  return result
}

/** 短生命周期会话执行 DDL / 维护语句。 */
export async function execSqliteSql(
  profileId: string,
  sql: string,
  schema?: string,
  limit = 50,
): Promise<SqliteQueryExecResult> {
  return withSqliteSession(profileId, (sessionId) => runExec(sessionId, sql, schema, limit))
}

/**
 * 优先复用已打开会话执行（ATTACH 库上的 PRAGMA / VACUUM 等需可见附加库）。
 * 无现成会话时回退短生命周期 session。
 */
export async function execSqliteSqlPreferred(
  profileId: string,
  sql: string,
  schema?: string,
  limit = 50,
): Promise<SqliteQueryExecResult> {
  return withPreferredSqliteSession(profileId, (sessionId) =>
    runExec(sessionId, sql, schema, limit),
  )
}
