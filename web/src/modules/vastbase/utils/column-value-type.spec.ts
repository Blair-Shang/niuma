import { describe, expect, it } from 'vitest'
import {
  alignForValueType,
  normalizeSqlDataType,
  resolveSqlValueType,
} from '@/modules/database/utils/column-value-type'

describe('resolveSqlValueType', () => {
  it('maps PG core types', () => {
    expect(resolveSqlValueType('boolean')).toBe('boolean')
    expect(resolveSqlValueType('bool')).toBe('boolean')
    expect(resolveSqlValueType('integer')).toBe('number')
    expect(resolveSqlValueType('numeric(12,2)')).toBe('number')
    expect(resolveSqlValueType('double precision')).toBe('number')
    expect(resolveSqlValueType('date')).toBe('date')
    expect(resolveSqlValueType('timestamp with time zone')).toBe('datetime')
    expect(resolveSqlValueType('timestamptz')).toBe('datetime')
    expect(resolveSqlValueType('jsonb')).toBe('textarea')
    expect(resolveSqlValueType('character varying(64)')).toBe('text')
    expect(resolveSqlValueType('varchar')).toBe('text')
  })

  it('maps VastBase / Oracle compatibility types', () => {
    expect(resolveSqlValueType('oradate')).toBe('datetime')
    expect(resolveSqlValueType('ORADATE')).toBe('datetime')
    expect(resolveSqlValueType('oratimestamp')).toBe('datetime')
    expect(resolveSqlValueType('oratimestamptz')).toBe('datetime')
    expect(resolveSqlValueType('number')).toBe('number')
    expect(resolveSqlValueType('NUMBER(18,2)')).toBe('number')
    expect(resolveSqlValueType('varchar2')).toBe('text')
    expect(resolveSqlValueType('varchar2(64)')).toBe('text')
    expect(resolveSqlValueType('nvarchar2(100)')).toBe('text')
    expect(resolveSqlValueType('binary_float')).toBe('number')
    expect(resolveSqlValueType('binary_double')).toBe('number')
    expect(resolveSqlValueType('clob')).toBe('textarea')
    expect(resolveSqlValueType('blob')).toBe('text')
    expect(resolveSqlValueType('raw')).toBe('text')
    expect(resolveSqlValueType('tinyint')).toBe('number')
  })

  it('normalizes precision wrappers and arrays', () => {
    expect(normalizeSqlDataType('NUMERIC(10, 2)')).toBe('numeric')
    expect(normalizeSqlDataType('timestamp(6) with time zone')).toBe(
      'timestamp with time zone',
    )
    expect(normalizeSqlDataType('int4[]')).toBe('int4')
  })

  it('aligns number / boolean', () => {
    expect(alignForValueType('number')).toBe('right')
    expect(alignForValueType('boolean')).toBe('center')
    expect(alignForValueType('text')).toBeUndefined()
  })
})
