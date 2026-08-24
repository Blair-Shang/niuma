/**
 * Oracle Browse 行编辑 / INSERT / WHERE 字面量拼装。
 * 标识符始终使用 Oracle 双引号引用。
 * DATE/TIMESTAMP 见 oracle-temporal-literal（对齐 dataio CSV 的 TO_DATE）。
 */
import {
  extractBrowseLobText,
  isBrowseBinaryLobCell,
  isBrowseLobCell,
} from '@/modules/database/utils/browse-cell-format'
import { quoteIdent } from '@/modules/oracle/sql-seed'
import { toOracleTemporalLiteral } from '@/modules/oracle/utils/oracle-temporal-literal'

export { toOracleTemporalLiteral } from '@/modules/oracle/utils/oracle-temporal-literal'

/** 后端编码的二进制单元格：`{ $bin: base64 }` 或截断 BLOB `{ $lob }`。 */
export function isBinCell(value: unknown): boolean {
  return isBrowseBinaryLobCell(value)
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function toSqlLiteral(value: unknown, dataType?: string): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    if (isBinCell(value)) return 'NULL'
    // 未编辑的截断 CLOB：用 preview 拼字面量（完整内容需弹窗编辑后再提交）
    if (isBrowseLobCell(value)) {
      return quoteSqlString(extractBrowseLobText(value))
    }
    return quoteSqlString(JSON.stringify(value))
  }
  const text = String(value)
  if (text.toUpperCase() === 'NULL') return 'NULL'
  const temporal = toOracleTemporalLiteral(text, dataType)
  if (temporal) return temporal
  return quoteSqlString(text)
}

/** WHERE 等值片段：NULL 使用 IS NULL。 */
export function sqlWhereEquals(column: string, value: unknown, dataType?: string): string {
  return value === null || value === undefined
    ? `${quoteIdent(column)} IS NULL`
    : `${quoteIdent(column)} = ${toSqlLiteral(value, dataType)}`
}
