import { describe, expect, it } from 'vitest'
import {
  extractMysqlTypeLength,
  formatMysqlColumnTypeLabel,
} from './column-type-label'

describe('formatMysqlColumnTypeLabel', () => {
  it('prefers COLUMN_TYPE with length', () => {
    expect(formatMysqlColumnTypeLabel('varchar(255)', 'VARCHAR', { length: 255 })).toBe(
      'varchar(255)',
    )
  })

  it('attaches length for char-like / int display width', () => {
    expect(formatMysqlColumnTypeLabel(undefined, 'VARCHAR', { length: 64 })).toBe('VARCHAR(64)')
    expect(formatMysqlColumnTypeLabel('', 'TINYINT', { length: 1 })).toBe('TINYINT(1)')
  })

  it('attaches precision/scale for decimal', () => {
    expect(
      formatMysqlColumnTypeLabel(undefined, 'DECIMAL', { precision: 10, scale: 2 }),
    ).toBe('DECIMAL(10,2)')
  })

  it('does not attach length to datetime', () => {
    expect(formatMysqlColumnTypeLabel(undefined, 'DATETIME', { length: 19 })).toBe('DATETIME')
  })
})

describe('extractMysqlTypeLength', () => {
  it('parses first numeric arg', () => {
    expect(extractMysqlTypeLength('tinyint(1)')).toBe(1)
    expect(extractMysqlTypeLength('decimal(10,2)')).toBe(10)
    expect(extractMysqlTypeLength('int')).toBeUndefined()
  })
})
