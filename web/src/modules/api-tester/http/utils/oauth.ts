/**
 * OAuth 2.0：客户端凭证、密码模式、授权码（PKCE）。
 * 令牌请求复用 api.http.exchange，不另开传输。
 */
import { apiHttpApi } from '@/api'
import type { ApiOAuth2, ApiRequest } from '../../types'
import { loadApiCookies, saveApiCookies } from './cookie-jar'
import { httpTransportOf } from '../settings/settings'

const SKEW_MS = 60_000

export function emptyOAuth(): ApiOAuth2 {
  return {
    grant: 'client_credentials',
    clientAuth: 'basic',
    accessTokenUrl: '',
    authUrl: '',
    callbackUrl: 'http://127.0.0.1:53682/callback',
    clientId: '',
    clientSecret: '',
    scope: '',
    username: '',
    password: '',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    codeVerifier: '',
  }
}

export class OAuthError extends Error {
  readonly code: 'need-token' | 'token-failed'

  constructor(code: 'need-token' | 'token-failed', message: string) {
    super(message)
    this.name = 'OAuthError'
    this.code = code
  }
}

/** 发送前补齐访问令牌。授权码模式只自动刷新，不打开浏览器。 */
export async function ensureOAuthToken(
  req: ApiRequest,
  interpolate: (text: string) => string,
  insecure: boolean,
  signal?: AbortSignal,
  options?: { force?: boolean },
): Promise<void> {
  const oauth = req.auth?.oauth2
  if (!oauth || req.auth.type !== 'oauth2') return
  const force = options?.force === true
  if (!force && fresh(oauth)) return
  if (!force && oauth.refreshToken.trim() && (oauth.grant === 'authorization_code' || oauth.accessToken.trim())) {
    await requestToken(req, interpolate, insecure, 'refresh_token', signal)
    return
  }
  if (oauth.grant === 'authorization_code') {
    throw new OAuthError('need-token', 'need token')
  }
  await requestToken(req, interpolate, insecure, oauth.grant, signal)
}

/** 用授权码或整段回调 URL 换访问令牌。 */
export async function exchangeAuthCode(
  req: ApiRequest,
  interpolate: (text: string) => string,
  callbackOrCode: string,
  insecure: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const code = extractAuthCode(callbackOrCode)
  if (!code) throw new OAuthError('token-failed', 'missing code')
  await requestToken(req, interpolate, insecure, 'authorization_code', signal, code)
}

/** 拼出授权码地址，并把 PKCE verifier 记在请求上。 */
export async function buildAuthorizeUrl(
  req: ApiRequest,
  interpolate: (text: string) => string,
): Promise<string> {
  const oauth = requireOAuth(req)
  const verifier = randomVerifier()
  oauth.codeVerifier = verifier
  const challenge = await sha256Base64Url(verifier)
  const authUrl = interpolate(oauth.authUrl).trim()
  if (!authUrl) throw new OAuthError('token-failed', 'missing auth url')
  const url = new URL(authUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', interpolate(oauth.clientId).trim())
  url.searchParams.set('redirect_uri', interpolate(oauth.callbackUrl).trim() || 'http://127.0.0.1:53682/callback')
  const scope = interpolate(oauth.scope).trim()
  if (scope) url.searchParams.set('scope', scope)
  url.searchParams.set('state', randomVerifier().slice(0, 16))
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export function parseOAuthToken(body: string, now = Date.now()): {
  accessToken: string
  refreshToken: string
  expiresAt: number
  tokenType: string
} {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new OAuthError('token-failed', body.trim().slice(0, 280) || 'token response')
  }
  const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token : ''
  if (!accessToken) {
    const message = typeof parsed.error_description === 'string' ? parsed.error_description : typeof parsed.error === 'string' ? parsed.error : body.slice(0, 280)
    throw new OAuthError('token-failed', message)
  }
  const refreshToken = typeof parsed.refresh_token === 'string' ? parsed.refresh_token : ''
  const expiresIn = typeof parsed.expires_in === 'number' ? parsed.expires_in : Number(parsed.expires_in)
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : 0
  const tokenType = typeof parsed.token_type === 'string' ? parsed.token_type : 'Bearer'
  return { accessToken, refreshToken, expiresAt, tokenType }
}

export function extractAuthCode(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  if (!text.includes('://') && !text.includes('code=')) return text
  try {
    const url = new URL(text)
    return url.searchParams.get('code') ?? ''
  } catch {
    const match = /(?:^|[?&#])code=([^&#]+)/.exec(text)
    return match?.[1] ? decodeURIComponent(match[1]) : ''
  }
}

function fresh(oauth: ApiOAuth2): boolean {
  if (!oauth.accessToken.trim()) return false
  if (!oauth.expiresAt) return true
  return oauth.expiresAt - SKEW_MS > Date.now()
}

function requireOAuth(req: ApiRequest): ApiOAuth2 {
  if (!req.auth.oauth2) req.auth.oauth2 = emptyOAuth()
  return req.auth.oauth2
}

async function requestToken(
  req: ApiRequest,
  interpolate: (text: string) => string,
  insecure: boolean,
  grant: ApiOAuth2['grant'] | 'refresh_token',
  signal?: AbortSignal,
  code = '',
): Promise<void> {
  const oauth = requireOAuth(req)
  const tokenUrl = interpolate(oauth.accessTokenUrl).trim()
  if (!tokenUrl) throw new OAuthError('token-failed', 'missing token url')
  const clientId = interpolate(oauth.clientId).trim()
  const clientSecret = interpolate(oauth.clientSecret)
  const fields = new URLSearchParams()
  fields.set('grant_type', grant === 'refresh_token' ? 'refresh_token' : grant)
  if (grant === 'refresh_token') fields.set('refresh_token', oauth.refreshToken.trim())
  if (grant === 'password') {
    fields.set('username', interpolate(oauth.username))
    fields.set('password', interpolate(oauth.password))
  }
  if (grant === 'authorization_code') {
    fields.set('code', code)
    fields.set('redirect_uri', interpolate(oauth.callbackUrl).trim())
    if (oauth.codeVerifier) fields.set('code_verifier', oauth.codeVerifier)
  }
  const scope = interpolate(oauth.scope).trim()
  if (scope && grant !== 'refresh_token') fields.set('scope', scope)
  if (clientId) fields.set('client_id', clientId)
  if (oauth.clientAuth !== 'basic' && clientSecret) fields.set('client_secret', clientSecret)
  const headers = [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }, { name: 'Accept', value: 'application/json' }]
  if (oauth.clientAuth === 'basic' && clientId) {
    headers.push({ name: 'Authorization', value: `Basic ${basic(clientId, clientSecret)}` })
  }
  if (signal?.aborted) throw new OAuthError('token-failed', 'cancelled')
  const cancelId = crypto.randomUUID()
  const onAbort = () => {
    void apiHttpApi.cancel({ cancelId }).catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort)
  try {
    const transport = httpTransportOf(req, interpolate)
    const result = await apiHttpApi.exchange({
      cancelId,
      method: 'POST',
      url: tokenUrl,
      headers,
      body: fields.toString(),
      followRedirects: false,
      insecure: insecure || transport.insecure,
      timeoutMs: transport.timeoutMs,
      proxy: transport.proxy,
      certPath: transport.certPath,
      keyPath: transport.keyPath,
      cookies: loadApiCookies(),
    })
    if (result.cookies) saveApiCookies(result.cookies)
    if (result.status >= 400) {
      throw new OAuthError('token-failed', result.body.trim().slice(0, 280) || `HTTP ${result.status}`)
    }
    const token = parseOAuthToken(result.body)
    oauth.accessToken = token.accessToken
    if (token.refreshToken) oauth.refreshToken = token.refreshToken
    oauth.expiresAt = token.expiresAt
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

function basic(id: string, secret: string): string {
  return btoa(unescape(encodeURIComponent(`${id}:${secret}`)))
}

function randomVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64Url(bytes)
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64Url(new Uint8Array(digest))
}

function base64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
