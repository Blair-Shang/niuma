import { describe, expect, it } from 'vitest'
import { runSequential } from './execute'
import type { ApiExchange, ApiRequest } from '../types'

function req(id: string): ApiRequest {
  return {
    id,
    name: id,
    method: 'GET',
    url: `http://127.0.0.1/${id}`,
    params: [],
    headers: [],
    auth: { type: 'none' },
    bodyMode: 'none',
    body: '',
  }
}

function okExchange(status = 200): ApiExchange {
  return {
    ok: true,
    status,
    statusText: 'OK',
    durationMs: 5,
    sizeBytes: 2,
    protocol: 'HTTP/1.1',
    headers: [],
    body: 'ok',
  }
}

describe('collection run', () => {
  it('runs each request once per iteration and counts assertion failures', async () => {
    const seen: string[] = []
    const report = await runSequential({
      requests: [req('a'), req('b')],
      iterations: 2,
      thinkTimeMs: 0,
      signal: new AbortController().signal,
      send: async (item) => {
        seen.push(item.id)
        if (item.id === 'b') {
          return { ...okExchange(500), ok: false, checks: [{ ok: false, kind: 'status', detail: '500 / 200' }] }
        }
        return okExchange()
      },
    })
    expect(seen).toEqual(['a', 'b', 'a', 'b'])
    expect(report.passed).toBe(2)
    expect(report.failed).toBe(2)
    expect(report.stopped).toBe(false)
  })

  it('stops before the next request when aborted', async () => {
    const ac = new AbortController()
    const report = await runSequential({
      requests: [req('a'), req('b')],
      iterations: 1,
      thinkTimeMs: 0,
      signal: ac.signal,
      send: async (item) => {
        if (item.id === 'a') ac.abort()
        return okExchange()
      },
    })
    expect(report.items.map((item) => item.requestId)).toEqual(['a'])
    expect(report.stopped).toBe(true)
  })
})
