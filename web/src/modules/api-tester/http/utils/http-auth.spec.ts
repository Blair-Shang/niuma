import { describe, expect, it } from 'vitest'
import { minimalRequest } from '../../utils/collection-io'
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

  it('sends oauth2 access token as bearer', () => {
    const headers = new Map<string, string>()
    applyAuthHeaders(
      minimalRequest({
        auth: {
          type: 'oauth2',
          oauth2: {
            grant: 'client_credentials',
            clientAuth: 'basic',
            accessTokenUrl: 'https://auth.example/token',
            authUrl: '',
            callbackUrl: '',
            clientId: 'id',
            clientSecret: 'secret',
            scope: '',
            username: '',
            password: '',
            accessToken: 'oauth-token',
            refreshToken: '',
            expiresAt: 0,
            codeVerifier: '',
          },
        },
      }),
      headers,
      (text) => text,
    )
    expect(headers.get('authorization')).toBe('Bearer oauth-token')
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
