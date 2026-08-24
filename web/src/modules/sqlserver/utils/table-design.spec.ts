import { describe, expect, it } from 'vitest'
import {
  applyColumnTypeBase,
  clampColumnTypeParams,
  syncColumnDataType,
} from './table-design'

describe('applyColumnTypeBase', () => {
  it('does not reuse NVARCHAR length as DECIMAL precision', () => {
    const next = applyColumnTypeBase(
      { typeBase: 'NVARCHAR', typeLength: 50 },
      'DECIMAL',
    )
    expect(next).toMatchObject({
      typeBase: 'DECIMAL',
      typeLength: 18,
      typeScale: 2,
      dataType: 'DECIMAL(18,2)',
    })
  })

  it('keeps precision when switching DECIMAL to NUMERIC', () => {
    const next = applyColumnTypeBase(
      { typeBase: 'DECIMAL', typeLength: 10, typeScale: 4 },
      'NUMERIC',
    )
    expect(next).toMatchObject({
      typeBase: 'NUMERIC',
      typeLength: 10,
      typeScale: 4,
      dataType: 'NUMERIC(10,4)',
    })
  })

  it('resets invalid precision leftover when staying on precision kinds', () => {
    const next = applyColumnTypeBase(
      { typeBase: 'DECIMAL', typeLength: 50, typeScale: 2 },
      'NUMERIC',
    )
    expect(next.typeLength).toBe(18)
    expect(next.dataType).toBe('NUMERIC(18,2)')
  })

  it('keeps length when switching NVARCHAR to VARCHAR', () => {
    const next = applyColumnTypeBase(
      { typeBase: 'NVARCHAR', typeLength: 128 },
      'VARCHAR',
    )
    expect(next).toMatchObject({
      typeBase: 'VARCHAR',
      typeLength: 128,
      dataType: 'VARCHAR(128)',
    })
  })
})

describe('clampColumnTypeParams', () => {
  it('caps DECIMAL precision at 38', () => {
    expect(
      clampColumnTypeParams({ typeBase: 'DECIMAL', typeLength: 50, typeScale: 2 }),
    ).toEqual({ typeLength: 38, typeScale: 2 })
  })

  it('does not change VARCHAR length', () => {
    expect(clampColumnTypeParams({ typeBase: 'VARCHAR', typeLength: 50 })).toEqual({
      typeLength: 50,
      typeScale: undefined,
    })
  })
})

describe('syncColumnDataType', () => {
  it('renders DECIMAL with precision and scale', () => {
    expect(
      syncColumnDataType({ typeBase: 'DECIMAL', typeLength: 18, typeScale: 2 }),
    ).toBe('DECIMAL(18,2)')
  })
})
