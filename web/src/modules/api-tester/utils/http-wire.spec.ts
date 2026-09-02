import { describe, expect, it } from 'vitest'
import { newKvRow } from './format'
import { buildHttpRequest, parseHttpResponse } from './http-wire'
import type { ApiRequest } from '../types'

const env = { id: 'local', name: 'Local', baseUrl: 'http://127.0.0.1:8080' }

function req(partial: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: '1',
    name: 'Hit',
    method: 'GET',
    url: '{{baseUrl}}/x',
    params: [],
    headers: [newKvRow('Accept', 'application/json')],
    body: '',
    ...partial,
  }
}

describe('api tester http wire', () => {
  it('builds GET with host and connection close', () => {
    const wire = buildHttpRequest(req(), env, '/api/items?limit=20', 'example.com', 80)
    expect(wire).toContain('GET /api/items?limit=20 HTTP/1.1')
    expect(wire).toContain('Host: example.com')
    expect(wire).toContain('Connection: close')
    expect(wire.endsWith('\r\n\r\n')).toBe(true)
  })

  it('adds content-length for POST body', () => {
    const wire = buildHttpRequest(
      req({ method: 'POST', body: 'hi', headers: [newKvRow('Content-Type', 'text/plain')] }),
      env,
      '/echo',
      '127.0.0.1',
      8080,
    )
    expect(wire).toContain('POST /echo HTTP/1.1')
    expect(wire).toContain('Host: 127.0.0.1:8080')
    expect(wire).toContain('Content-Length: 2')
    expect(wire.endsWith('hi')).toBe(true)
  })

  it('parses a complete response', () => {
    const raw = 'HTTP/1.1 201 Created\r\nContent-Length: 5\r\nX-Id: 1\r\n\r\nhello'
    const parsed = parseHttpResponse(raw, 'POST')
    expect(parsed).toMatchObject({ status: 201, statusText: 'Created', body: 'hello', complete: true })
    expect(parsed?.headers.some((row) => row.key === 'X-Id' && row.value === '1')).toBe(true)
  })

  it('marks incomplete when body is short', () => {
    const raw = 'HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nabc'
    expect(parseHttpResponse(raw, 'GET')?.complete).toBe(false)
  })
})
