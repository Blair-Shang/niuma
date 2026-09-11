/** 本地日历日 YYYY-MM-DD，避免 ISO 按 UTC 切日。 */
export function localDayKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function shiftLocalDay(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days)
}

export type HistoryDayKind = 'today' | 'yesterday' | 'date'

export function historyDayKind(dayKey: string, now = new Date()): HistoryDayKind {
  if (!dayKey) {
    return 'date'
  }
  if (dayKey === localDayKey(now)) {
    return 'today'
  }
  if (dayKey === localDayKey(shiftLocalDay(now, -1))) {
    return 'yesterday'
  }
  return 'date'
}

export function formatHistoryClock(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return date.toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatHistoryDateLabel(dayKey: string, locale: string): string {
  const parts = dayKey.split('-').map((part) => Number(part))
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return dayKey
  }
  const date = new Date(parts[0]!, parts[1]! - 1, parts[2])
  return date.toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function groupHistoryByDay<T extends { createdAt: string }>(
  items: readonly T[],
): { day: string; items: T[] }[] {
  const order: string[] = []
  const map = new Map<string, T[]>()
  for (const item of items) {
    const day = localDayKey(item.createdAt) || 'unknown'
    let list = map.get(day)
    if (!list) {
      list = []
      map.set(day, list)
      order.push(day)
    }
    list.push(item)
  }
  return order.map((day) => ({ day, items: map.get(day) ?? [] }))
}
