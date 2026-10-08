/**
 * HTTP / HTTPS 发送。解析仍在前端；TLS、重定向、Cookie 和 HTTP/2 由 api-service 完成。
 */
import { apiHttpApi, BridgeError, isBridgeAvailable } from '@/api'
import type { ApiHttpExchangeResult } from '@/api/types/api-http'
import { i18n } from '@/locale'
import type { ApiEnvironment, ApiExchange, ApiRequest } from '../../types'
import type { ApiVariableScope } from '../../utils/folder-tree'
import { newKvRow } from '../../utils/format'
import { isSocketMethod, parseTarget, TargetError, type SocketTarget } from '../../utils/target'
import { loadApiCookies, saveApiCookies } from './cookie-jar'
import { GraphQLBodyError } from '../graphql/body'
import { applyMessageHeaders, titleHttpHeader } from './http-wire'
import { interpolateVariables, resolveRequest } from './request-resolve'
import { OAuthError, ensureOAuthToken } from './oauth'
import { applyAwsSigV4 } from './aws-sig'
import { buildDigestAuthorization, parseDigestChallenge } from './digest'
import { httpTransportOf } from '../settings/settings'

export type SendErrorCode = 'need-desktop' | 'cancelled' | 'oauth' | TargetError['code']

export class SendError extends Error {
  readonly code: SendErrorCode

  constructor(code: SendErrorCode, message: string) {
    super(message)
    this.name = 'SendError'
    this.code = code
  }
}

const SEND_ERROR_KEYS: Record<string, string> = {
  'need-desktop': 'modules.api.needDesktop',
  ws: 'modules.api.wsUnsupported',
  'bad-url': 'modules.api.badUrl',
  oauth: 'modules.api.oauthNeedToken',
}

export interface ResolvedSend {
  target: SocketTarget
  payload: string
}

export function resolveSend(
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  scope?: ApiVariableScope,
): ResolvedSend {
  if (!isBridgeAvailable()) {
    throw new SendError('need-desktop', 'desktop only')
  }
  const resolved = resolveRequest(req, env, scope)
  let target: SocketTarget
  try {
    target = parseTarget(resolved.url, req.method)
  } catch (error) {
    if (error instanceof TargetError) {
      throw new SendError(error.code, error.message)
    }
    throw error
  }
  const payload = target.http
    ? ''
    : resolved.body
  return { target, payload }
}

/** 通过 api-service 发送 HTTP / HTTPS，并写回 Cookie。 */
export async function executeRequest(
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  signal: AbortSignal,
  scope?: ApiVariableScope,
): Promise<ApiExchange> {
  let preview
  try {
    preview = resolveRequest(req, env, scope)
  } catch (error) {
    throw localizeBodyError(error)
  }
  if (!isBridgeAvailable()) {
    throw new SendError('need-desktop', 'desktop only')
  }
  let target: ReturnType<typeof parseTarget>
  try {
    target = parseTarget(preview.url, req.method)
  } catch (error) {
    if (error instanceof TargetError) {
      throw new SendError(error.code, error.message)
    }
    throw error
  }
  if (!target.http || !target.url) {
    throw new SendError('bad-url', 'invalid url')
  }
  throwIfAborted(signal)
  const cancelId = crypto.randomUUID()
  const onAbort = () => {
    void apiHttpApi.cancel({ cancelId }).catch(() => undefined)
  }
  signal.addEventListener('abort', onAbort)
  try {
    let resolved = preview
    if (req.auth?.type === 'oauth2') {
      try {
        await ensureOAuthToken(
          req,
          (text) => interpolateVariables(text, resolved.values),
          req.insecureTLS === true,
          signal,
        )
      } catch (error) {
        if (error instanceof OAuthError && error.code === 'need-token') {
          throw new SendError('oauth', 'oauth')
        }
        if (error instanceof OAuthError) throw new Error(error.message)
        throw error
      }
      try {
        resolved = resolveRequest(req, env, scope)
      } catch (error) {
        throw localizeBodyError(error)
      }
      try {
        target = parseTarget(resolved.url, req.method)
      } catch (error) {
        if (error instanceof TargetError) throw new SendError(error.code, error.message)
        throw error
      }
      if (!target.url) throw new SendError('bad-url', 'invalid url')
    }
    const formParts = formPartsOf(req, resolved.values)
    const headerMap = new Map(
      [...applyMessageHeaders(req.method, resolved.body, resolved.headers).entries()]
        .filter(([key]) => key !== 'content-length' && key !== 'connection')
        .filter(([key]) => formParts.length === 0 || key !== 'content-type'),
    )
    const fill = (text: string) => interpolateVariables(text, resolved.values)
    if (req.auth?.type === 'awsv4' && req.auth.awsv4) {
      const aws = req.auth.awsv4
      await applyAwsSigV4({
        method: req.method,
        url: target.url,
        headers: headerMap,
        body: formParts.length > 0 ? '' : resolved.body,
        accessKey: fill(aws.accessKey),
        secretKey: fill(aws.secretKey),
        region: fill(aws.region),
        service: fill(aws.service),
        sessionToken: fill(aws.sessionToken),
      })
    }
    const headers = [...headerMap.entries()].map(([name, value]) => ({ name: titleHttpHeader(name), value }))
    const transport = httpTransportOf(req, fill)
    const ntlm = req.auth?.type === 'ntlm' ? req.auth.ntlm : undefined
    const call = (nextHeaders: { name: string; value: string }[]) => apiHttpApi.exchange({
      cancelId,
      method: req.method,
      url: target.url,
      headers: nextHeaders,
      body: req.method === 'GET' || req.method === 'HEAD' || formParts.length > 0 ? '' : resolved.body,
      parts: formParts.length > 0 ? formParts : undefined,
      timeoutMs: transport.timeoutMs,
      followRedirects: true,
      insecure: transport.insecure,
      proxy: transport.proxy,
      certPath: transport.certPath,
      keyPath: transport.keyPath,
      cookies: loadApiCookies(),
      ntlmUser: ntlm ? fill(ntlm.username) : undefined,
      ntlmPassword: ntlm ? fill(ntlm.password) : undefined,
      ntlmDomain: ntlm ? fill(ntlm.domain) : undefined,
    })
    let result = await call(headers)
    if (req.auth?.type === 'digest' && result.status === 401 && req.auth.digest) {
      const www = result.headers.find((row) => row.name.toLowerCase() === 'www-authenticate')?.value ?? ''
      const challenge = parseDigestChallenge(www)
      if (challenge) {
        const uri = `${new URL(target.url).pathname}${new URL(target.url).search}`
        const authorization = buildDigestAuthorization({
          username: fill(req.auth.digest.username),
          password: fill(req.auth.digest.password),
          method: req.method,
          uri,
          challenge,
        })
        result = await call([...headers, { name: 'Authorization', value: authorization }])
      }
    }
    saveApiCookies(result.cookies ?? [])
    return exchangeFromResult(result)
  } catch (error) {
    if (error instanceof BridgeError && error.message === 'cancelled') {
      throw new SendError('cancelled', 'cancelled')
    }
    if (error instanceof SendError) throw error
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export function failExchange(error: unknown, durationMs: number, protocol = ''): ApiExchange {
  const message = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    status: null,
    statusText: '',
    durationMs,
    sizeBytes: 0,
    protocol,
    headers: [],
    body: '',
    error: message,
  }
}

export function protocolOf(method: ApiRequest['method']): string {
  if (isSocketMethod(method)) return method
  if (method === 'GRPC') return 'gRPC'
  if (method === 'WS') return 'WebSocket'
  return 'HTTP/1.1'
}

export function localizeSendError(error: unknown): Error {
  if (!(error instanceof SendError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  const key = SEND_ERROR_KEYS[error.code]
  if (!key) return error
  return new Error(String(i18n.global.t(key)))
}

function localizeBodyError(error: unknown): Error {
  if (error instanceof GraphQLBodyError) {
    return new Error(String(i18n.global.t('modules.api.graphqlVariables')))
  }
  return error instanceof Error ? error : new Error(String(error))
}

function formPartsOf(req: ApiRequest, values: Record<string, string>) {
  if (req.bodyMode !== 'form') return []
  const parts = (req.bodyForm ?? [])
    .filter((row) => row.enabled && row.key.trim() && row.filePath?.trim())
    .map((row) => ({
      name: row.key.trim(),
      value: '',
      filePath: interpolateVariables(row.filePath ?? '', values),
    }))
  if (parts.length === 0) return []
  const text = (req.bodyForm ?? [])
    .filter((row) => row.enabled && row.key.trim() && !row.filePath?.trim())
    .map((row) => ({
      name: row.key.trim(),
      value: interpolateVariables(row.value, values),
    }))
  return [...text, ...parts]
}

function exchangeFromResult(result: ApiHttpExchangeResult): ApiExchange {
  const durationMs = result.durationMs > 0 ? result.durationMs : 1
  return {
    ok: result.status < 400,
    status: result.status,
    statusText: result.statusText,
    durationMs,
    sizeBytes: result.sizeBytes,
    protocol: result.protocol || 'HTTP/1.1',
    headers: (result.headers ?? []).map((header) => newKvRow(header.name, header.value)),
    body: result.body ?? '',
    hex: result.binary && result.bodyBase64 ? base64ToHex(result.bodyBase64) : undefined,
    binary: result.binary || undefined,
    redirects: result.redirects?.length ? result.redirects : undefined,
  }
}

function base64ToHex(value: string): string {
  const bin = atob(value)
  let hex = ''
  for (let i = 0; i < bin.length; i += 1) {
    hex += bin.charCodeAt(i).toString(16).padStart(2, '0')
  }
  return hex
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new SendError('cancelled', 'cancelled')
  }
}
