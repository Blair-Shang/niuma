import { describe, expect, it } from 'vitest'
import { defaultValueForKind, normalizeVariableKind } from './variable-kind'

describe('variable-kind', () => {
  it('falls back unknown kinds to string', () => {
    expect(normalizeVariableKind(undefined)).toBe('string')
    expect(normalizeVariableKind('oops')).toBe('string')
    expect(normalizeVariableKind('secret')).toBe('secret')
    expect(normalizeVariableKind('json')).toBe('json')
  })

  it('supplies parseable defaults', () => {
    expect(defaultValueForKind('boolean')).toBe('true')
    expect(defaultValueForKind('number')).toBe('0')
    expect(defaultValueForKind('json')).toBe('{}')
    expect(defaultValueForKind('string')).toBe('')
  })
})
