import { describe, expect, it } from 'vitest'
import { attachChecks, evaluateChecks, resolvePreSteps } from './eval'
import type { ApiExchange } from '../types'

const exchange = {
  ok: true,
  status: 200,
  statusText: 'OK',
  durationMs: 40,
  sizeBytes: 12,
  protocol: 'HTTP/1.1',
  headers: [{ id: 'h1', enabled: true, key: 'X-Trace', value: 'abc' }],
  body: '{"user":{"name":"ada"}}',
} satisfies ApiExchange

describe('script eval', () => {
  it('writes pre-request variables in order', () => {
    const writes = resolvePreSteps(
      [
        { id: '1', enabled: true, scope: 'environment', key: 'token', value: 'raw' },
        { id: '2', enabled: true, scope: 'global', key: 'auth', value: 'Bearer {{token}}' },
        { id: '3', enabled: false, scope: 'environment', key: 'skip', value: 'no' },
      ],
      {},
      (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_all, name: string) => values[name] ?? ''),
    )
    expect(writes).toEqual([
      { scope: 'environment', key: 'token', value: 'raw' },
      { scope: 'global', key: 'auth', value: 'Bearer raw' },
    ])
  })

  it('passes status, json path, header and duration checks', () => {
    const results = evaluateChecks(
      [
        { id: 's', enabled: true, kind: 'status', target: '', expect: '200' },
        { id: 'j', enabled: true, kind: 'jsonEquals', target: 'user.name', expect: 'ada' },
        { id: 'h', enabled: true, kind: 'header', target: 'x-trace', expect: 'abc' },
        { id: 't', enabled: true, kind: 'timeUnder', target: '', expect: '100' },
        { id: 'b', enabled: true, kind: 'bodyContains', target: '', expect: 'missing' },
      ],
      exchange,
    )
    expect(results.map((item) => item.ok)).toEqual([true, true, true, true, false])
    const failed = { ...exchange }
    attachChecks(failed, results)
    expect(failed.ok).toBe(false)
  })
})
