import { describe, expect, it } from 'vitest'
import { emptyHttpSettings, normalizeHttpSettings, timeoutMsOf } from './settings'

describe('http settings', () => {
  it('uses 30 seconds when timeout is missing', () => {
    expect(timeoutMsOf(undefined)).toBe(30_000)
    expect(timeoutMsOf(emptyHttpSettings())).toBe(30_000)
  })

  it('caps timeout and keeps proxy text', () => {
    const settings = normalizeHttpSettings({ timeoutMs: 9_000_000, proxy: 'http://127.0.0.1:7890' })
    expect(settings.timeoutMs).toBe(300_000)
    expect(settings.proxy).toBe('http://127.0.0.1:7890')
  })
})
