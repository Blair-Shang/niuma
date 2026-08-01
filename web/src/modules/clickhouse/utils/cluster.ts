/**
 * ClickHouse 连接默认集群名与 ON CLUSTER SQL 辅助。
 * 连接 options.cluster 仅表示 DDL 默认集群，不是多主机连接串。
 */
import { connectionApi } from '@/api'
import type { ClickHouseConnectionOptions } from '@/api/types/clickhouse'
import { quoteIdent } from '@/modules/clickhouse/sql-seed'
import type { ConnItem } from '@/modules/ops/types'

/** 从连接配置读取默认 ON CLUSTER 名。 */
export function connectionDefaultCluster(
  connOrOptions?: ConnItem | ClickHouseConnectionOptions | null,
): string {
  if (!connOrOptions) return ''
  if ('connectionOptions' in connOrOptions) {
    const options = connOrOptions.connectionOptions as ClickHouseConnectionOptions | undefined
    return options?.cluster?.trim() || ''
  }
  return connOrOptions.cluster?.trim() || ''
}

/** 按 profileId 读取连接默认集群（设计器 / 对象脚本无 ConnItem 时用）。 */
export async function fetchConnectionDefaultCluster(profileId: string): Promise<string> {
  const id = profileId.trim()
  if (!id) return ''
  try {
    const result = await connectionApi.get({ profileId: id })
    const options = result.profile?.connectionOptions as ClickHouseConnectionOptions | undefined
    return options?.cluster?.trim() || ''
  } catch {
    return ''
  }
}

/** 从 meta.clusters hosts 去重排序集群名。 */
export function uniqueClusterNames(
  hosts: Array<{ cluster?: string | null }> | undefined,
): string[] {
  return [
    ...new Set(
      (hosts ?? [])
        .map((h) => h.cluster?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort((a, b) => a.localeCompare(b))
}

/** ` ON CLUSTER \`name\``；空则返回空串。 */
export function onClusterSqlSuffix(onCluster?: string): string {
  const cluster = onCluster?.trim()
  if (!cluster) return ''
  return ` ON CLUSTER ${quoteIdent(cluster)}`
}

/**
 * 若 SQL 尚无 ON CLUSTER，则在 CREATE/DROP/TRUNCATE/RENAME/OPTIMIZE/DETACH/ATTACH
 * 的对象名后插入；已有则原样返回。
 */
export function ensureOnClusterClause(sql: string, onCluster?: string): string {
  const cluster = onCluster?.trim()
  if (!cluster) return sql
  const trimmed = sql.trim()
  if (!trimmed || /\bon\s+cluster\b/i.test(trimmed)) return trimmed

  const ident = '(?:`[^`]+`|"[^"]+"|[a-zA-Z0-9_$\\u0080-\\uffff]+)'
  const qname = `${ident}(?:\\s*\\.\\s*${ident})?`
  const re = new RegExp(
    `^((?:create\\s+(?:or\\s+replace\\s+)?(?:materialized\\s+view|view|dictionary|table|database)|` +
      `drop\\s+(?:table|view|dictionary|database)|` +
      `truncate\\s+table|` +
      `rename\\s+table|` +
      `optimize\\s+table|` +
      `detach\\s+table|` +
      `attach\\s+table)` +
      `(?:\\s+if\\s+(?:not\\s+)?exists)?\\s+${qname})`,
    'i',
  )
  const m = re.exec(trimmed)
  if (!m?.[1]) return trimmed
  const insertAt = m[1].length
  return `${trimmed.slice(0, insertAt)}${onClusterSqlSuffix(cluster)}${trimmed.slice(insertAt)}`
}
