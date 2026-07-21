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

/** 日期时间解析：兼容空格分隔与 ISO `T` 分隔（表格/后端常见） */
export const RS_DATETIME_PARSE_FORMATS = [
  RS_DATETIME_FORMAT,
  'YYYY-MM-DD HH:mm',
  'YYYY-MM-DDTHH:mm:ss',
  'YYYY-MM-DDTHH:mm',
  'YYYY-MM-DDTHH:mm:ss.SSS',
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
  // 去掉末尾 Z / 偏移，按本地墙钟解析（选中态与展示一致）
  const normalized = value
    .trim()
    .replace(/Z$/i, '')
    .replace(/[+-]\d{2}:?\d{2}$/, '')
  for (const format of RS_DATETIME_PARSE_FORMATS) {
    const parsed = dayjs(normalized, format, true)
    if (parsed.isValid()) return parsed
  }
  return null
}

export { dayjs }
