import dayjs, { type Dayjs } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'

dayjs.extend(customParseFormat)

/** 日期 v-model / 展示格式 */
export const RS_DATE_FORMAT = 'YYYY-MM-DD'

/** 日期时间 v-model / 展示格式 */
export const RS_DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss'

/** 时间片段格式（含秒） */
export const RS_TIME_SECONDS_FORMAT = 'HH:mm:ss'

/** 时间片段格式（分钟精度） */
export const RS_TIME_MINUTE_FORMAT = 'HH:mm'

export const RS_DATE_PARSE_FORMATS = [
  RS_DATE_FORMAT,
  'YYYY/MM/DD',
  'YYYY-M-D',
] as const

export function parseRsDayjs(
  value?: string,
  formats: readonly string[] = RS_DATE_PARSE_FORMATS,
): Dayjs | null {
  if (!value) return null
  const parsed = dayjs(value, [...formats], true)
  return parsed.isValid() ? parsed : null
}

export function parseRsDateTimeDayjs(value?: string): Dayjs | null {
  if (!value) return null
  const parsed = dayjs(value, RS_DATETIME_FORMAT, true)
  return parsed.isValid() ? parsed : null
}

export { dayjs }
