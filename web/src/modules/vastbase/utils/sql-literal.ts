/** @deprecated 请从 `@/modules/database` 导入；保留别名避免旧引用断裂。 */
export { parseEditValue } from '@/modules/database/utils/sql-literal'

/** SQL 字面量拼装（浏览行编辑 / INSERT / WHERE）—— PG / VastBase 布尔用 TRUE/FALSE。 */
export function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  }
  const s = String(value)
  if (s.toUpperCase() === 'NULL') return 'NULL'
  return `'${s.replace(/'/g, "''")}'`
}
