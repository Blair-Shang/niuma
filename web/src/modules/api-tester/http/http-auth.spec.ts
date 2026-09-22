import { describe, expect, it } from 'vitest'
import { minimalRequest } from '../utils/collection-io'
import { applyAuthHeaders, authQueryParam } from './http-auth'

describe('http-auth', () => {
  it('adds bearer authorization header', () => {
    const headers = new Map<string, string>()
    applyAuthHeaders(
      minimalRequest({
        auth: { type: 'bearer', bearer: { token: '{{token}}' } },
      }),
      headers,
      (text) => (text === '{{token}}' ? 'abc' : text),
    )
    expect(headers.get('authorization')).toBe('Bearer abc')
  })

  it('adds basic authorization header', () => {
    const headers = new Map<string, string>()
    applyAuthHeaders(
      minimalRequest({
        auth: { type: 'basic', basic: { username: 'u', password: 'p' } },
      }),
      headers,
      (text) => text,
    )
    expect(headers.get('authorization')).toBe(`Basic ${btoa('u:p')}`)
  })

  it('returns query api key param', () => {
    const param = authQueryParam(
      minimalRequest({
        auth: { type: 'apikey', apiKey: { key: 'api_key', value: 'v', in: 'query' } },
      }),
      (text) => text,
    )
    expect(param).toEqual({ key: 'api_key', value: 'v' })
  })
})
