/**
 * 表数据浏览单元格展示：NULL / 日期时间 / JSON 对象。
 * date·datetime 走 @niuma/ui 规范格式（YYYY-MM-DD[ HH:mm:ss]）。
 */
import { formatDateTimeValue, formatDateValue } from '@niuma/ui'
import type { GridCellValueType } from './column-value-type'

export function formatBrowseCellValue(
  value: unknown,
  valueType: GridCellValueType = 'text',
): string {
  if (value === null || value === undefined) return 'NULL'
  if (valueType === 'date') {
    const raw = String(value)
    return formatDateValue(raw) || raw
  }
  if (valueType === 'datetime') {
    const raw = String(value)
    return formatDateTimeValue(raw) || raw
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
