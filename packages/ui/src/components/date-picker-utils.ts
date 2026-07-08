import {
  dayjs,
  parseRsDateTimeDayjs,
  parseRsDayjs,
  RS_DATE_FORMAT,
  RS_DATETIME_FORMAT,
  RS_TIME_MINUTE_FORMAT,
  RS_TIME_SECONDS_FORMAT,
} from '../lib/rs-dayjs'

export interface RsParsedDate {
  year: number
  month: number
  day: number
}

export interface RsParsedDateTime extends RsParsedDate {
  hour: number
  minute: number
  second: number
}

export interface RsDateRangeValue {
  start?: string
  end?: string
}

export interface RsCalendarCell extends RsParsedDate {
  inCurrentMonth: boolean
}

export const EMPTY_DATE_RANGE: RsDateRangeValue = {}

export function parseDateValue(value?: string): RsParsedDate | null {
  const parsed = parseRsDayjs(value)
  if (!parsed) return null
  return {
    year: parsed.year(),
    month: parsed.month() + 1,
    day: parsed.date(),
  }
}

export function parseDateTimeValue(value?: string): RsParsedDateTime | null {
  const parsed = parseRsDateTimeDayjs(value)
  if (!parsed) return null
  return {
    year: parsed.year(),
    month: parsed.month() + 1,
    day: parsed.date(),
    hour: parsed.hour(),
    minute: parsed.minute(),
    second: parsed.second(),
  }
}

export function formatDateValue(value?: string): string {
  const parsed = parseRsDayjs(value)
  return parsed ? parsed.format(RS_DATE_FORMAT) : (value ?? '')
}

export function formatDateParts(date: RsParsedDate): string {
  return dayjs()
    .year(date.year)
    .month(date.month - 1)
    .date(date.day)
    .format(RS_DATE_FORMAT)
}

export function formatDateTimeValue(value?: string): string {
  const parsed = parseRsDateTimeDayjs(value)
  return parsed ? parsed.format(RS_DATETIME_FORMAT) : (value ?? '')
}

export function formatDateTimeParts(
  date: RsParsedDate,
  time: string,
  withSeconds = true,
): string | null {
  const dateText = formatDateParts(date)
  const timeFormat = withSeconds ? RS_TIME_SECONDS_FORMAT : RS_TIME_MINUTE_FORMAT
  const parsed = dayjs(`${dateText} ${time}`, `${RS_DATE_FORMAT} ${timeFormat}`, true)
  if (!parsed.isValid()) return null
  return parsed.format(RS_DATETIME_FORMAT)
}

export function extractTimeFromDateTime(value?: string, withSeconds = true): string {
  const parsed = parseRsDateTimeDayjs(value)
  if (!parsed) return withSeconds ? '00:00:00' : '00:00'
  return parsed.format(withSeconds ? RS_TIME_SECONDS_FORMAT : RS_TIME_MINUTE_FORMAT)
}

export function isDateRangeOrdered(range: RsDateRangeValue): boolean {
  if (!range.start || !range.end) return true
  const start = parseRsDateTimeDayjs(range.start) ?? parseRsDayjs(range.start)
  const end = parseRsDateTimeDayjs(range.end) ?? parseRsDayjs(range.end)
  if (!start || !end) return range.start <= range.end
  return start.isSame(end) || start.isBefore(end)
}

export const isDateTimeRangeOrdered = isDateRangeOrdered

export function formatDateRangeDisplay(
  range: RsDateRangeValue,
  options?: { separator?: string; datetime?: boolean },
): string {
  const separator = options?.separator ?? ' ~ '
  const format = options?.datetime ? formatDateTimeDisplay : formatDateDisplay
  const start = range.start ? format(range.start) : ''
  const end = range.end ? format(range.end) : ''
  if (start && end) return `${start}${separator}${end}`
  return start || end
}

export function formatLocalDate(date: Date): string {
  return dayjs(date).format(RS_DATE_FORMAT)
}

export function formatDateDisplay(value?: string): string {
  return formatDateValue(value)
}

export function formatDateTimeDisplay(value?: string): string {
  return formatDateTimeValue(value)
}

export function formatDateRangeLabel(range: RsDateRangeValue, separator = ' ~ '): string {
  return formatDateRangeDisplay(range, { separator })
}

export function formatDateTimeRangeLabel(range: RsDateRangeValue, separator = ' ~ '): string {
  return formatDateRangeDisplay(range, { separator, datetime: true })
}

export function isDateBetween(value: string, start?: string, end?: string): boolean {
  if (!start || !end) return false
  const current = parseRsDayjs(value)
  const from = parseRsDayjs(start)
  const to = parseRsDayjs(end)
  if (!current || !from || !to) return false
  const min = from.isBefore(to) ? from : to
  const max = from.isBefore(to) ? to : from
  return (current.isSame(min) || current.isAfter(min)) && (current.isSame(max) || current.isBefore(max))
}

export function getTodayDate(): RsParsedDate {
  const today = dayjs()
  return {
    year: today.year(),
    month: today.month() + 1,
    day: today.date(),
  }
}

export function formatTimeFromDateTimeParts(
  value: RsParsedDateTime,
  withSeconds = true,
): string {
  const hour = String(value.hour).padStart(2, '0')
  const minute = String(value.minute).padStart(2, '0')
  if (!withSeconds) return `${hour}:${minute}`
  const second = String(value.second).padStart(2, '0')
  return `${hour}:${minute}:${second}`
}

export function getNowDateTime(): RsParsedDateTime {
  const now = dayjs()
  return {
    year: now.year(),
    month: now.month() + 1,
    day: now.date(),
    hour: now.hour(),
    minute: now.minute(),
    second: now.second(),
  }
}

export function getNextMonth(year: number, month: number): Pick<RsParsedDate, 'year' | 'month'> {
  const next = dayjs().year(year).month(month - 1).add(1, 'month')
  return { year: next.year(), month: next.month() + 1 }
}

export function getDaysInMonth(year: number, month: number): number {
  return dayjs().year(year).month(month - 1).daysInMonth()
}

export function dateToNumber(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day
}

export function parseDateToNumber(value: string): number | null {
  const parsed = parseDateValue(value)
  if (!parsed) return null
  return dateToNumber(parsed.year, parsed.month, parsed.day)
}

export function compareDates(a: RsParsedDate, b: RsParsedDate): number {
  return dateToNumber(a.year, a.month, a.day) - dateToNumber(b.year, b.month, b.day)
}

export function isSameDate(a: RsParsedDate, b: RsParsedDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
}

export function isDateBetweenParsed(
  cell: RsParsedDate,
  start: RsParsedDate,
  end: RsParsedDate,
): boolean {
  const value = dateToNumber(cell.year, cell.month, cell.day)
  const from = dateToNumber(start.year, start.month, start.day)
  const to = dateToNumber(end.year, end.month, end.day)
  return value >= Math.min(from, to) && value <= Math.max(from, to)
}

export function isDateWithinBounds(
  year: number,
  month: number,
  day: number,
  options: { minDate?: string; maxDate?: string } = {},
): boolean {
  const candidate = dateToNumber(year, month, day)

  if (options.minDate) {
    const min = parseDateToNumber(options.minDate)
    if (min !== null && candidate < min) return false
  }

  if (options.maxDate) {
    const max = parseDateToNumber(options.maxDate)
    if (max !== null && candidate > max) return false
  }

  return true
}

export function isDateRangeEmpty(value: RsDateRangeValue): boolean {
  return !value.start && !value.end
}

export function buildCalendarGrid(
  year: number,
  month: number,
  weekStartsOn = 1,
): RsCalendarCell[] {
  const daysInMonth = getDaysInMonth(year, month)
  const firstWeekday = dayjs().year(year).month(month - 1).date(1).day()
  const leading = (firstWeekday - weekStartsOn + 7) % 7

  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth)

  const cells: RsCalendarCell[] = []

  for (let index = leading; index > 0; index -= 1) {
    cells.push({
      year: prevYear,
      month: prevMonth,
      day: daysInPrevMonth - index + 1,
      inCurrentMonth: false,
    })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ year, month, day, inCurrentMonth: true })
  }

  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  let nextDay = 1

  while (cells.length < 42) {
    cells.push({
      year: nextYear,
      month: nextMonth,
      day: nextDay,
      inCurrentMonth: false,
    })
    nextDay += 1
  }

  return cells
}
