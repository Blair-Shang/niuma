import { describe, expect, it } from 'vitest'
import {
  defaultNodeOpen,
  isJsonContainer,
  jsonEntries,
  jsonKind,
  jsonPreview,
  prettyJson,
  JSON_TREE_AUTO_OPEN_MAX,
} from './json-tree'

describe('json-tree helpers', () => {
  it('classifies scalars and containers', () => {
    expect(jsonKind(null)).toBe('null')
    expect(jsonKind('hi')).toBe('string')
    expect(jsonKind(2)).toBe('number')
    expect(jsonKind(true)).toBe('boolean')
    expect(jsonKind([1])).toBe('array')
    expect(jsonKind({ a: 1 })).toBe('object')
    expect(isJsonContainer(null)).toBe(false)
    expect(isJsonContainer({ a: 1 })).toBe(true)
  })

  it('previews size instead of dumping nested values', () => {
    expect(jsonPreview({ a: 1, b: 2 })).toBe('Object(2)')
    expect(jsonPreview([1, 2, 3])).toBe('Array(3)')
    expect(jsonPreview('ok')).toBe('"ok"')
  })

  it('lists object keys and array indexes', () => {
    expect(jsonEntries({ code: 200, data: { x: 1 } })).toEqual([
      { key: 'code', value: 200 },
      { key: 'data', value: { x: 1 } },
    ])
    expect(jsonEntries(['a', 'b'])).toEqual([
      { key: '0', value: 'a' },
      { key: '1', value: 'b' },
    ])
  })

  it('opens the first nested object so fields are visible', () => {
    const fields: Record<string, number> = {}
    for (let i = 0; i < 47; i += 1) {
      fields[`f${i}`] = i
    }
    expect(defaultNodeOpen(1, fields)).toBe(true)
    expect(defaultNodeOpen(2, fields)).toBe(false)
    expect(defaultNodeOpen(1, {})).toBe(false)
  })

  it('keeps oversized first-level collections collapsed', () => {
    const big = Array.from({ length: JSON_TREE_AUTO_OPEN_MAX + 1 }, (_, i) => i)
    expect(defaultNodeOpen(1, big)).toBe(false)
  })

  it('pretty-prints for copy and falls back on failure', () => {
    expect(prettyJson({ a: 1 }, '{}')).toBe('{\n  "a": 1\n}')
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(prettyJson(cyclic, 'fallback')).toBe('fallback')
  })
})
