/**
 * MySQL 列类型展示：优先 information_schema.COLUMN_TYPE（含长度），
 * 否则用驱动 DatabaseTypeName + length / precision / scale 补全。
 */

export type MysqlTypeSize = {
  length?: number | null
  precision?: number | null
  scale?: number | null
}

/** 从类型串提取第一个数字参数（如 tinyint(1) → 1、decimal(10,2) → 10）。 */
export function extractMysqlTypeLength(dataType?: string | null): number | undefined {
  const m = /\(\s*(\d+)/.exec(dataType ?? '')
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

function shouldAttachLength(typeName: string): boolean {
  const t = typeName.toLowerCase().replace(/\s+/g, ' ').trim()
  return /^(var)?char$|^(var)?binary$|^bit$|^tinyint$|^smallint$|^mediumint$|^int$|^integer$|^bigint$|^year$/.test(
    t,
  )
}

/**
 * 表头提示用类型文案。
 * @param preferred 优先值（通常为 COLUMN_TYPE，已含长度）
 * @param fallback 驱动类型名（常无长度）
 */
export function formatMysqlColumnTypeLabel(
  preferred?: string | null,
  fallback?: string | null,
  size?: MysqlTypeSize,
): string {
  const preferredTrim = (preferred ?? '').trim()
  if (preferredTrim) return preferredTrim

  const base = (fallback ?? '').trim()
  if (!base) return ''
  if (/\(/.test(base)) return base

  const precision = size?.precision
  const scale = size?.scale
  if (typeof precision === 'number' && Number.isFinite(precision)) {
    if (typeof scale === 'number' && Number.isFinite(scale)) {
      return `${base}(${precision},${scale})`
    }
    return `${base}(${precision})`
  }

  const length = size?.length
  if (
    typeof length === 'number' &&
    Number.isFinite(length) &&
    length >= 0 &&
    shouldAttachLength(base)
  ) {
    return `${base}(${length})`
  }
  return base
}
