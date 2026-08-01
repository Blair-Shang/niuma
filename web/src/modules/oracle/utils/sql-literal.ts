/**
 * Oracle Browse 行编辑 / INSERT / WHERE 字面量拼装。
 * 标识符始终使用Oracle双引号引用。
 */
import { quoteIdent } from '@/modules/oracle/sql-seed'

/** 后端编码的二进制单元格：`{ $bin: base64 }`。 */
export function isBinCell(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      '$bin' in (value as Record<string, unknown>),
  )
}

export function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    if (isBinCell(value)) return 'NULL'
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  }
  const text = String(value)
  if (text.toUpperCase() === 'NULL') return 'NULL'
  return `'${text.replace(/'/g, "''")}'`
}

/** WHERE 等值片段：NULL 使用 IS NULL。 */
export function sqlWhereEquals(column: string, value: unknown): string {
  return value === null || value === undefined
    ? `${quoteIdent(column)} IS NULL`
    : `${quoteIdent(column)} = ${toSqlLiteral(value)}`
}
