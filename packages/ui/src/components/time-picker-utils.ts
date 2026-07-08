export interface RsParsedTime {
  hour: number
  minute: number
  second: number
}

export interface RsTimeRangeValue {
  start?: string
  end?: string
}

export const EMPTY_TIME_RANGE: RsTimeRangeValue = {}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
const TIME_WITH_SECONDS_PATTERN = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/

export function scheduleAfterPaint(callback: () => void): () => void {
  let cancelled = false
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!cancelled) callback()
    })
  })
  return () => {
    cancelled = true
  }
}

export function rangeInclusive(max: number): number[] {
  return Array.from({ length: max + 1 }, (_, index) => index)
}

export function parseTimeValue(value?: string, withSeconds = false): RsParsedTime | null {
  if (!value?.trim()) return null
  const trimmed = value.trim()
  const pattern = withSeconds ? TIME_WITH_SECONDS_PATTERN : TIME_PATTERN
  const match = pattern.exec(trimmed)
  if (!match) return null
  return {
    hour: Number.parseInt(match[1], 10),
    minute: Number.parseInt(match[2], 10),
    second: withSeconds ? Number.parseInt(match[3], 10) : 0,
  }
}

export function formatTimeParts(hour: number, minute: number, second?: number): string {
  const h = String(hour).padStart(2, '0')
  const m = String(minute).padStart(2, '0')
  if (second !== undefined) return `${h}:${m}:${String(second).padStart(2, '0')}`
  return `${h}:${m}`
}

export function formatTimeFromParts(
  hour: number,
  minute: number,
  second: number,
  withSeconds = false,
): string {
  return formatTimeParts(hour, minute, withSeconds ? second : undefined)
}

export function getCurrentTime(): RsParsedTime {
  const now = new Date()
  return {
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
  }
}

export function formatTimeValue(value?: string): string {
  return value ?? ''
}

export function timeToSeconds(hour: number, minute: number, second = 0): number {
  return hour * 3600 + minute * 60 + second
}

export function parseTimeToSeconds(value: string, withSeconds = false): number | null {
  const parsed = parseTimeValue(value, withSeconds)
  if (!parsed) return null
  return timeToSeconds(parsed.hour, parsed.minute, parsed.second)
}

export function isTimeWithinBounds(
  hour: number,
  minute: number,
  second: number,
  options: { minTime?: string; maxTime?: string; withSeconds?: boolean } = {},
): boolean {
  const { minTime, maxTime, withSeconds = false } = options
  const candidate = timeToSeconds(hour, minute, second)

  if (minTime) {
    const minSeconds = parseTimeToSeconds(minTime, withSeconds)
    if (minSeconds !== null && candidate < minSeconds) return false
  }

  if (maxTime) {
    const maxSeconds = parseTimeToSeconds(maxTime, withSeconds)
    if (maxSeconds !== null && candidate > maxSeconds) return false
  }

  return true
}

export function isTimeRangeEmpty(value: RsTimeRangeValue): boolean {
  return !value.start?.trim() && !value.end?.trim()
}

export function isTimeRangeOrdered(
  range: RsTimeRangeValue,
  withSeconds = false,
): boolean {
  if (!range.start || !range.end) return true
  return isTimeRangeOrderedValues(range.start, range.end, withSeconds)
}

export function isTimeRangeOrderedValues(
  start: string,
  end: string,
  withSeconds = false,
): boolean {
  const startSeconds = parseTimeToSeconds(start, withSeconds)
  const endSeconds = parseTimeToSeconds(end, withSeconds)
  if (startSeconds === null || endSeconds === null) return true
  return startSeconds <= endSeconds
}

export function pickEarlierTime(
  a?: string,
  b?: string,
  withSeconds = false,
): string | undefined {
  if (!a) return b
  if (!b) return a
  const ta = parseTimeToSeconds(a, withSeconds)
  const tb = parseTimeToSeconds(b, withSeconds)
  if (ta === null) return b
  if (tb === null) return a
  return ta <= tb ? a : b
}

export function pickLaterTime(
  a?: string,
  b?: string,
  withSeconds = false,
): string | undefined {
  if (!a) return b
  if (!b) return a
  const ta = parseTimeToSeconds(a, withSeconds)
  const tb = parseTimeToSeconds(b, withSeconds)
  if (ta === null) return b
  if (tb === null) return a
  return ta >= tb ? a : b
}

export function formatTimeRangeDisplay(
  range: RsTimeRangeValue,
  options?: { separator?: string },
): string {
  const separator = options?.separator ?? ' ~ '
  const start = range.start ? formatTimeValue(range.start) : ''
  const end = range.end ? formatTimeValue(range.end) : ''
  if (start && end) return `${start}${separator}${end}`
  return start || end
}
