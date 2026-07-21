/** Compass 风格 BSON 类型色板 */
const TYPE_COLORS: Record<string, string> = {
  string: '#3b82f6',
  int: '#f97316',
  long: '#f97316',
  double: '#f97316',
  number: '#f97316',
  decimal: '#f97316',
  bool: '#eab308',
  date: '#22c55e',
  object: '#a855f7',
  coordinates: '#14b8a6',
  array: '#0d9488',
  objectId: '#6b7280',
  null: '#9ca3af',
  binData: '#64748b',
  regex: '#ec4899',
  timestamp: '#06b6d4',
}

const FALLBACK_COLOR = '#94a3b8'

export function schemaTypeColor(type: string): string {
  return TYPE_COLORS[type] ?? FALLBACK_COLOR
}

export function formatSchemaPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatSchemaNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value)) return value.toLocaleString()
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export function formatSchemaDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}
