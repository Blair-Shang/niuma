import { describe, expect, it } from 'vitest'
import { debugMessageBadge, parseDebugMessageLines } from './debug-assist'

describe('parseDebugMessageLines', () => {
  it('parses OK / ERR / NOTICE prefixes', () => {
    const items = parseDebugMessageLines([
      'OK  #1  SELECT …  → 1 row(s)  12ms',
      'ERR  object invalid',
      'NOTICE  hello',
      'plain line',
    ])
    expect(items.map((x) => x.tone)).toEqual(['ok', 'err', 'info', 'info'])
    expect(items[0]!.text).toMatch(/^#1/)
    expect(items[1]!.text).toBe('object invalid')
    expect(items[2]!.text).toBe('hello')
    expect(items[3]!.text).toBe('plain line')
  })

  it('badge labels match tone', () => {
    expect(debugMessageBadge('ok')).toBe('OK')
    expect(debugMessageBadge('err')).toBe('ERR')
    expect(debugMessageBadge('info')).toBe('·')
  })
})
