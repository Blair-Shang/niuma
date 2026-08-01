/**
 * ClickHouse 树 DDL / 元数据：始终短暂 open/close。
 * 不复用查询 Tab 会话（ClickHouse 无传统事务，但仍隔离长查询占用）。
 */
import { clickhouseApi } from '@/api/clickhouse'
import type { ClickHouseQueryExecResult } from '@/api/types/clickhouse'

export async function withClickHouseSession<T>(
  profileId: string,
  fn: (sessionId: string) => Promise<T>,
): Promise<T> {
  const opened = await clickhouseApi.sessionOpen({ profileId })
  try {
    return await fn(opened.sessionId)
  } finally {
    await clickhouseApi.sessionClose({ sessionId: opened.sessionId }).catch(() => undefined)
  }
}

export async function execClickHouseSql(
  profileId: string,
  sql: string,
  database?: string,
): Promise<ClickHouseQueryExecResult> {
  return withClickHouseSession(profileId, async (sessionId) => {
    const result = await clickhouseApi.queryExec({
      sessionId,
      database,
      sql,
      limit: 50,
    })
    if (result.resultSetId) {
      await clickhouseApi
        .queryClose({ sessionId, resultSetId: result.resultSetId })
        .catch(() => undefined)
    }
    return result
  })
}
