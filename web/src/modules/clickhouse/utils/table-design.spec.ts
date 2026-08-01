import { describe, expect, it } from 'vitest'
import {
  composeEngine,
  composeKeyExpression,
  parseDataType,
  parseEngine,
  parseKeyExpression,
  syncColumnDataType,
} from './table-design'

describe('clickhouse table-design', () => {
  it('parses and syncs Nullable + LowCardinality', () => {
    const parsed = parseDataType('LowCardinality(Nullable(String))')
    expect(parsed).toMatchObject({
      typeBase: 'String',
      nullable: true,
      lowCardinality: true,
    })
    expect(
      syncColumnDataType({
        typeBase: 'String',
        typeInner: '',
        enumValues: '',
        nullable: true,
        lowCardinality: true,
      }),
    ).toBe('LowCardinality(Nullable(String))')
  })

  it('handles FixedString / DateTime64 params', () => {
    expect(parseDataType('FixedString(32)').typeLength).toBe(32)
    expect(
      syncColumnDataType({
        typeBase: 'DateTime64',
        typeLength: 6,
        typeInner: '',
        enumValues: '',
        nullable: false,
        lowCardinality: false,
      }),
    ).toBe('DateTime64(6)')
  })

  it('handles Decimal precision and scale', () => {
    expect(parseDataType('Decimal(18, 4)')).toMatchObject({
      typeBase: 'Decimal',
      typeLength: 18,
      typeScale: 4,
    })
    expect(parseDataType('Decimal64(2)')).toMatchObject({
      typeBase: 'Decimal64',
      typeScale: 2,
    })
    expect(
      syncColumnDataType({
        typeBase: 'Decimal',
        typeLength: 10,
        typeScale: 2,
        typeInner: '',
        enumValues: '',
        nullable: false,
        lowCardinality: false,
      }),
    ).toBe('Decimal(10, 2)')
    expect(
      syncColumnDataType({
        typeBase: 'Decimal128',
        typeScale: 6,
        typeInner: '',
        enumValues: '',
        nullable: true,
        lowCardinality: false,
      }),
    ).toBe('Nullable(Decimal128(6))')
  })

  it('handles Array / Map / Enum', () => {
    expect(parseDataType('Array(UInt64)')).toMatchObject({
      typeBase: 'Array',
      typeInner: 'UInt64',
    })
    expect(parseDataType("Map(String, Array(UInt8))")).toMatchObject({
      typeBase: 'Map',
      typeInner: 'String, Array(UInt8)',
    })
    expect(parseDataType("Enum8('a' = 1, 'b' = 2)")).toMatchObject({
      typeBase: 'Enum8',
      enumValues: "'a' = 1, 'b' = 2",
    })
    expect(
      syncColumnDataType({
        typeBase: 'Array',
        typeInner: 'Nullable(String)',
        enumValues: '',
        nullable: false,
        lowCardinality: false,
      }),
    ).toBe('Array(Nullable(String))')
    expect(
      syncColumnDataType({
        typeBase: 'Enum8',
        typeInner: '',
        enumValues: "'x' = 1",
        nullable: false,
        lowCardinality: false,
      }),
    ).toBe("Enum8('x' = 1)")
  })

  it('handles AggregateFunction / Nested', () => {
    expect(parseDataType('SimpleAggregateFunction(sum, UInt64)')).toMatchObject({
      typeBase: 'SimpleAggregateFunction',
      typeInner: 'sum, UInt64',
    })
    expect(
      syncColumnDataType({
        typeBase: 'AggregateFunction',
        typeInner: 'uniqExact, String',
        enumValues: '',
        nullable: false,
        lowCardinality: false,
      }),
    ).toBe('AggregateFunction(uniqExact, String)')
  })

  it('composes engine with args', () => {
    expect(composeEngine('MergeTree', '')).toBe('MergeTree')
    expect(composeEngine('ReplacingMergeTree', 'ver')).toBe('ReplacingMergeTree(ver)')
    expect(parseEngine('VersionedCollapsingMergeTree(sign, version)')).toEqual({
      base: 'VersionedCollapsingMergeTree',
      args: 'sign, version',
    })
  })

  it('composes multi-column ORDER BY', () => {
    expect(composeKeyExpression(['dt', 'id'])).toBe('(dt, id)')
    expect(composeKeyExpression(['id'])).toBe('id')
    expect(parseKeyExpression('(dt, id)')).toEqual(['dt', 'id'])
    expect(parseKeyExpression('toYYYYMM(dt)')).toEqual(['toYYYYMM(dt)'])
  })
})
