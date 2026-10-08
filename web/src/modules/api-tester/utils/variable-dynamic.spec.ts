import { describe, expect, it } from 'vitest'
import { materializeVariableValue } from './variable-dynamic'

const now = new Date(2026, 8, 24, 18, 6, 5)

describe('materializeVariableValue', () => {
  it('formats the current date and time', () => {
    expect(materializeVariableValue('datetime', 'now:date', now)).toBe('2026-09-24')
    expect(materializeVariableValue('datetime', 'now:time', now)).toBe('18:06:05')
    expect(materializeVariableValue('datetime', 'now:datetime', now)).toBe('2026-09-24 18:06:05')
    expect(materializeVariableValue('datetime', 'now:unix', now)).toBe(String(Math.floor(now.getTime() / 1000)))
    expect(materializeVariableValue('datetime', '2006-01-02T15:04:05Z', now)).toBe('2006-01-02T15:04:05Z')
  })

  it('keeps fixed numbers and draws random integers inside the range', () => {
    expect(materializeVariableValue('number', '42', now)).toBe('42')
    const value = Number(materializeVariableValue('number', 'random:int:1:3', now))
    expect(value).toBeGreaterThanOrEqual(1)
    expect(value).toBeLessThanOrEqual(3)
    expect(Number.isInteger(value)).toBe(true)
  })

  it('generates a uuid only for the each-send marker', () => {
    expect(materializeVariableValue('uuid', 'uuid:each', now)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(materializeVariableValue('uuid', 'fixed-id', now)).toBe('fixed-id')
  })
})
