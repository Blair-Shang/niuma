/** 浏览网格复制为 INSERT / UPDATE / DELETE（方括号 + N'…'）。 */

import { qualifiedName, quoteIdent } from '@/modules/sqlserver/sql-seed'
import { toSqlLiteral } from '@/modules/sqlserver/utils/sql-literal'

export function sqlWhereEquals(column: string, value: unknown): string {
  if (value === null || value === undefined) {
    return `${quoteIdent(column)} IS NULL`
  }
  return `${quoteIdent(column)} = ${toSqlLiteral(value)}`
}

function resolveKeyColumns(
  keyColumns: string[],
  fallbackColumns: string[],
  row: Record<string, unknown>,
): string[] {
  if (keyColumns.length > 0) return keyColumns
  if (fallbackColumns.length > 0) return fallbackColumns
  return Object.keys(row).filter((key) => !key.startsWith('__'))
}

export function buildInsertSqlText(
  schema: string,
  table: string,
  columns: Array<{ name: string }>,
  rows: unknown[][],
): string {
  const cols = columns.map((column) => quoteIdent(column.name)).join(', ')
  const target = qualifiedName(schema, table)
  if (rows.length === 0) return '-- no rows\n'
  const tuples = rows.map((row) => `(${columns.map((_, i) => toSqlLiteral(row[i] ?? null)).join(', ')})`)
  return `INSERT INTO ${target} (${cols}) VALUES ${tuples.join(', ')};\n`
}

export function buildDeleteSqlText(
  schema: string,
  table: string,
  keyColumns: string[],
  rows: Array<Record<string, unknown>>,
  fallbackColumns: string[] = [],
): string {
  const target = qualifiedName(schema, table)
  if (rows.length === 0) return '-- no rows\n'
  return `${rows
    .map((row) => {
      const cols = resolveKeyColumns(keyColumns, fallbackColumns, row)
      if (cols.length === 0) return '-- no columns'
      return `DELETE FROM ${target} WHERE ${cols.map((col) => sqlWhereEquals(col, row[col])).join(' AND ')};`
    })
    .join('\n')}\n`
}

export function buildUpdateSqlText(
  schema: string,
  table: string,
  columns: string[],
  keyColumns: string[],
  rows: Array<Record<string, unknown>>,
  fallbackColumns: string[] = [],
): string {
  const target = qualifiedName(schema, table)
  if (rows.length === 0 || columns.length === 0) return '-- no rows\n'
  return `${rows
    .map((row) => {
      const keys = resolveKeyColumns(keyColumns, fallbackColumns, row)
      if (keys.length === 0) return '-- no columns'
      const set = columns.map((col) => `${quoteIdent(col)} = ${toSqlLiteral(row[col])}`).join(', ')
      const where = keys.map((col) => sqlWhereEquals(col, row[col])).join(' AND ')
      return `UPDATE ${target} SET ${set} WHERE ${where};`
    })
    .join('\n')}\n`
}
