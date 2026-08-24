import { describe, expect, it } from 'vitest'
import { parseDataType, splitDataTypeFields } from './table-design'

describe('oracle parseDataType', () => {
  it('parses VARCHAR2 length', () => {
    expect(parseDataType('VARCHAR2(100)')).toMatchObject({
      base: 'VARCHAR2',
      length: 100,
    })
  })

  it('parses VARCHAR2 with BYTE suffix', () => {
    expect(parseDataType('VARCHAR2(100 BYTE)')).toMatchObject({
      base: 'VARCHAR2',
      length: 100,
    })
  })

  it('parses NUMBER precision and scale', () => {
    expect(parseDataType('NUMBER(18,2)')).toMatchObject({
      base: 'NUMBER',
      precision: 18,
      scale: 2,
    })
  })

  it('parses TIMESTAMP WITH TIME ZONE fractional seconds', () => {
    expect(parseDataType('TIMESTAMP(6) WITH TIME ZONE')).toMatchObject({
      base: 'TIMESTAMP WITH TIME ZONE',
      length: 6,
    })
  })
})

describe('oracle splitDataTypeFields', () => {
  it('maps catalog types into design row fields', () => {
    expect(splitDataTypeFields('VARCHAR2(255)')).toMatchObject({
      typeBase: 'VARCHAR2',
      typeLength: 255,
      dataType: 'VARCHAR2(255)',
    })
    expect(splitDataTypeFields('NUMBER(10,2)')).toMatchObject({
      typeBase: 'NUMBER',
      typeLength: 10,
      typeScale: 2,
      dataType: 'NUMBER(10,2)',
    })
  })

  it('preserves CHAR length semantics on round-trip', () => {
    expect(splitDataTypeFields('VARCHAR2(50 CHAR)')).toMatchObject({
      typeBase: 'VARCHAR2',
      typeLength: 50,
      typeLengthSemantics: 'CHAR',
      dataType: 'VARCHAR2(50 CHAR)',
    })
  })
})
