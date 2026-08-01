/**
 * SQLite Browse 行编辑 / INSERT / WHERE 字面量拼装。
 * 标识符引用见 sql-seed；勿从其它库模块导入字面量工具。
 */
import { quoteIdent } from '@/modules/sqlite/sql-seed'

/** 后端 encode 的非 UTF-8 BLOB：`{ $bin: base64 }`。 */
export function isBinCell(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      '$bin' in (value as Record<string, unknown>),
  )
}

/** null→NULL；bool→0/1；number；BLOB 对象保持只读不拼写；string 转义单引号。 */
export function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL'
    return String(value)
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    if (isBinCell(value)) {
      const b64 = String((value as { $bin: unknown }).$bin ?? '')
      // base64 → hex blob literal；非法则 NULL，避免把 JSON 写进 BLOB 列
      try {
        const bin =
          typeof atob === 'function'
            ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
            : null
        if (!bin) return 'NULL'
        let hex = ''
        for (let i = 0; i < bin.length; i++) {
          hex += bin[i]!.toString(16).padStart(2, '0')
        }
        return `X'${hex}'`
      } catch {
        return 'NULL'
      }
    }
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  }
  const s = String(value)
  if (s.toUpperCase() === 'NULL') return 'NULL'
  return `'${s.replace(/'/g, "''")}'`
}

/** WHERE 等值片段：NULL 用 IS NULL。 */
export function sqlWhereEquals(column: string, value: unknown): string {
  if (value === null || value === undefined) {
    return `${quoteIdent(column)} IS NULL`
  }
  return `${quoteIdent(column)} = ${toSqlLiteral(value)}`
}
