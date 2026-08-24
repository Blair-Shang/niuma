/**
 * Oracle LOB 完整加载：拼单列 SELECT 并调用 query.loadLob。
 */
import { oracleApi } from '@/api/oracle'
import {
  extractBrowseLobText,
  formatBrowseBinViewText,
  formatBrowseLobSummary,
  getBrowseLobMarker,
  isBrowseBinCell,
  isBrowseBinaryLobCell,
  isBrowseLobCell,
} from '@/modules/database/utils/browse-cell-format'
import { quoteIdent } from '@/modules/oracle/sql-seed'

export function isTruncatedLobCell(value: unknown): boolean {
  const lob = getBrowseLobMarker(value)
  return Boolean(lob?.truncated)
}

/** Browse：按主键 WHERE 取单列 LOB。 */
export function buildBrowseLobSelectSql(
  schema: string,
  table: string,
  column: string,
  whereSql: string,
): string {
  return (
    `SELECT ${quoteIdent(column)}\n` +
    `FROM ${quoteIdent(schema)}.${quoteIdent(table)}\n` +
    `WHERE ${whereSql}`
  )
}

/**
 * Query：从结果集行定位单列（外包一层 FETCH）。
 * 原 SQL 须为可嵌套的单语句 SELECT。
 */
export function buildQueryLobSelectSql(sourceSql: string, column: string, rowIndex: number): string {
  const offset = Math.max(0, rowIndex)
  const inner = sourceSql.trim().replace(/;+\s*$/, '')
  return (
    `SELECT ${quoteIdent(column)}\n` +
    `FROM (\n${inner}\n) q\n` +
    `OFFSET ${offset} ROWS FETCH NEXT 1 ROWS ONLY`
  )
}

export function formatLoadedLobValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (isBrowseBinCell(value)) return formatBrowseBinViewText(value)
  if (isBrowseBinaryLobCell(value)) return formatBrowseLobSummary(value)
  if (isBrowseLobCell(value)) return extractBrowseLobText(value)
  return String(value)
}

export async function loadOracleLobFull(opts: {
  sessionId: string
  schema?: string
  sql: string
  maxBytes?: number
}): Promise<{ value: unknown; truncated?: boolean; type?: string; text: string }> {
  const result = await oracleApi.queryLoadLob({
    sessionId: opts.sessionId,
    schema: opts.schema,
    sql: opts.sql,
    maxBytes: opts.maxBytes,
  })
  return {
    value: result.value,
    truncated: result.truncated,
    type: result.type,
    text: formatLoadedLobValue(result.value),
  }
}
