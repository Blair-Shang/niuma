import { describe, expect, it } from 'vitest'
import {
  composeDataType,
  defaultCreateTableColumns,
  parseDataType,
  splitDataTypeFields,
  VAST_COMMON_DATA_TYPES,
} from './table-design'

describe('table-design', () => {
  it('provides common PG types', () => {
    expect(VAST_COMMON_DATA_TYPES).toContain('BIGINT')
    expect(VAST_COMMON_DATA_TYPES).toContain('TIMESTAMPTZ')
    expect(VAST_COMMON_DATA_TYPES).toContain('JSONB')
  })

  it('seeds create-table defaults with PK id', () => {
    const cols = defaultCreateTableColumns()
    expect(cols.length).toBe(2)
    expect(cols[0]?.name).toBe('id')
    expect(cols[0]?.primaryKey).toBe(true)
    expect(cols[0]?.nullable).toBe(false)
    expect(cols[1]?.name).toBe('created_at')
  })

  it('parses and composes length/precision types', () => {
    expect(parseDataType('VARCHAR(64)')).toMatchObject({
      base: 'VARCHAR',
      length: 64,
    })
    expect(parseDataType('NUMERIC(18,2)')).toMatchObject({
      base: 'NUMERIC',
      precision: 18,
      scale: 2,
    })
    expect(parseDataType('TIMESTAMP(6)')).toMatchObject({
      base: 'TIMESTAMP',
      length: 6,
    })
    expect(composeDataType({ base: 'VARCHAR', length: 128 })).toBe('VARCHAR(128)')
    expect(composeDataType({ base: 'VARCHAR' })).toBe('VARCHAR')
    expect(composeDataType({ base: 'CHAR' })).toBe('CHAR(1)')
    expect(composeDataType({ base: 'TIMESTAMP', length: 3 })).toBe('TIMESTAMP(3)')
    expect(composeDataType({ base: 'TIMESTAMP' })).toBe('TIMESTAMP')
    expect(composeDataType({ base: 'NUMERIC', precision: 10, scale: 4 })).toBe('NUMERIC(10,4)')
    expect(composeDataType({ base: 'NUMERIC', precision: 5, scale: 8 })).toBe('NUMERIC(5,5)')
    expect(composeDataType({ base: 'BIGINT' })).toBe('BIGINT')
  })

  it('splits type/length/scale for cell editing', () => {
    expect(splitDataTypeFields('VARCHAR(64)')).toEqual({
      typeBase: 'VARCHAR',
      typeLength: '64',
      typeScale: '',
      dataType: 'VARCHAR(64)',
    })
    expect(splitDataTypeFields('NUMERIC(18,2)')).toEqual({
      typeBase: 'NUMERIC',
      typeLength: '18',
      typeScale: '2',
      dataType: 'NUMERIC(18,2)',
    })
    expect(defaultCreateTableColumns()[0]?.typeBase).toBe('BIGINT')
    expect(defaultCreateTableColumns()[0]?.typeLength).toBe('')
  })
})
