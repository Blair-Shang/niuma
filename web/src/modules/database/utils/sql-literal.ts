/** 单元格草稿解析（浏览行编辑 / INSERT）；字面量拼装由方言提供。 */

/** 将单元格草稿还原为原始值；空串 / NULL → null。 */
export function parseEditValue(draft: unknown, previousRaw?: unknown): unknown {
  if (draft === null || draft === undefined) return null
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
