/** SQL 字面量拼装（浏览行编辑 / INSERT / WHERE）。 */

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

/** 将单元格草稿还原为原始值；空串 / NULL → null。 */
export function parseEditValue(draft: unknown, previousRaw?: unknown): unknown {
  if (draft === null || draft === undefined) return null
  // RsTable 按 valueType 解析后可能已是 boolean / number
  if (typeof draft === 'boolean') return draft
  if (typeof draft === 'number' && Number.isFinite(draft)) return draft
  if (typeof draft === 'bigint') return draft
  const s = String(draft).trim()
  if (s === '' || s.toUpperCase() === 'NULL') return null
  if (typeof previousRaw === 'number' && s !== '' && !Number.isNaN(Number(s))) {
    return Number(s)
  }
  if (typeof previousRaw === 'boolean') {
    const lower = s.toLowerCase()
    if (lower === 'true' || lower === 't' || lower === '1') return true
    if (lower === 'false' || lower === 'f' || lower === '0') return false
  }
  return s
}
