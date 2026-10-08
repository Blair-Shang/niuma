import { beforeEach, describe, expect, it, vi } from 'vitest'
import { minimalRequest } from '../../utils/collection-io'
import { emptyOAuth, ensureOAuthToken, extractAuthCode, parseOAuthToken } from './oauth'

const exchange = vi.fn()

vi.mock('@/api', () => ({
  apiHttpApi: {
    exchange: (...args: unknown[]) => exchange(...args),
    cancel: vi.fn(),
  },
}))

describe('oauth', () => {
  beforeEach(() => {
    exchange.mockReset()
  })

  it('parses an access token and expiry', () => {
    const token = parseOAuthToken('{"access_token":"abc","expires_in":60,"refresh_token":"ref"}', 1_000)
    expect(token.accessToken).toBe('abc')
    expect(token.refreshToken).toBe('ref')
    expect(token.expiresAt).toBe(61_000)
  })

  it('reads a code from a callback url', () => {
    expect(extractAuthCode('http://127.0.0.1:53682/callback?code=xyz&state=s')).toBe('xyz')
    expect(extractAuthCode('plain-code')).toBe('plain-code')
  })

  it('posts client credentials and stores the access token', async () => {
    exchange.mockResolvedValue({
      status: 200,
      body: '{"access_token":"issued","expires_in":10}',
      cookies: [],
    })
    const req = minimalRequest({
      auth: {
        type: 'oauth2',
        oauth2: {
          ...emptyOAuth(),
          accessTokenUrl: 'https://auth.example/token',
          clientId: '{{id}}',
          clientSecret: 'secret',
          scope: 'read',
        },
      },
    })
    await ensureOAuthToken(req, (text) => (text === '{{id}}' ? 'app' : text), false)
    const body = String(exchange.mock.calls[0]?.[0]?.body)
    expect(body).toContain('grant_type=client_credentials')
    expect(body).toContain('client_id=app')
    expect(body).not.toContain('client_secret')
    expect(req.auth.oauth2?.accessToken).toBe('issued')
  })
})
