import { describe, expect, it } from 'vitest'
import {
  formatDateDisplay,
  formatDateTimeDisplay,
  formatDateTimeValue,
  formatDateValue,
  parseDateTimeValue,
  parseDateValue,
} from '../components/date-picker-utils'
import { RS_DATE_FORMAT, RS_DATETIME_FORMAT } from '../lib/rs-dayjs'

describe('date-picker-utils (dayjs)', () => {
  it('uses fixed date format constant', () => {
    expect(RS_DATE_FORMAT).toBe('YYYY-MM-DD')
    expect(RS_DATETIME_FORMAT).toBe('YYYY-MM-DD HH:mm:ss')
  })

  it('formats and parses date values', () => {
    expect(formatDateValue('2025-06-16')).toBe('2025-06-16')
    expect(formatDateDisplay('2025-06-16')).toBe('2025-06-16')
    expect(parseDateValue('2025-06-16')).toEqual({ year: 2025, month: 6, day: 16 })
  })

  it('formats and parses datetime values', () => {
    expect(formatDateTimeValue('2025-06-16 14:30:00')).toBe('2025-06-16 14:30:00')
    expect(formatDateTimeDisplay('2025-06-16 14:30:00')).toBe('2025-06-16 14:30:00')
    expect(parseDateTimeValue('2025-06-16 14:30:00')).toEqual({
      year: 2025,
      month: 6,
      day: 16,
      hour: 14,
      minute: 30,
      second: 0,
    })
  })

  it('parses ISO-like datetime and normalizes to canonical form', () => {
    expect(parseDateTimeValue('2025-06-16T14:30:00')).toEqual({
      year: 2025,
      month: 6,
      day: 16,
      hour: 14,
      minute: 30,
      second: 0,
    })
    expect(parseDateTimeValue('2025-06-16T14:30')).toEqual({
      year: 2025,
      month: 6,
      day: 16,
      hour: 14,
      minute: 30,
      second: 0,
    })
    expect(parseDateTimeValue('2025-06-16 14:30')).toEqual({
      year: 2025,
      month: 6,
      day: 16,
      hour: 14,
      minute: 30,
      second: 0,
    })
    expect(formatDateTimeValue('2025-06-16T14:30:00')).toBe('2025-06-16 14:30:00')
  })

  it('rejects unrecognizable datetime strings', () => {
    expect(parseDateTimeValue('not-a-date')).toBeNull()
    expect(formatDateTimeValue('not-a-date')).toBe('not-a-date')
  })
})
