/**
 * HTTP 传输设置：超时、代理、客户端证书。
 * 只做归一化和发给 api.http.exchange 的字段，不发请求。
 */
import type { ApiHttpSettings, ApiRequest } from '../../types'

export const HTTP_TIMEOUT_DEFAULT_MS = 30_000
export const HTTP_TIMEOUT_MAX_MS = 5 * 60_000

export function emptyHttpSettings(): ApiHttpSettings {
  return {
    timeoutMs: HTTP_TIMEOUT_DEFAULT_MS,
    proxy: '',
    certPath: '',
    keyPath: '',
  }
}

export function timeoutMsOf(settings: ApiHttpSettings | undefined): number {
  const value = settings?.timeoutMs
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return HTTP_TIMEOUT_DEFAULT_MS
  return Math.min(Math.round(value), HTTP_TIMEOUT_MAX_MS)
}

export function normalizeHttpSettings(raw: unknown): ApiHttpSettings {
  const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    timeoutMs: timeoutMsOf({
      timeoutMs: typeof item.timeoutMs === 'number' ? item.timeoutMs : HTTP_TIMEOUT_DEFAULT_MS,
      proxy: '',
      certPath: '',
      keyPath: '',
    }),
    proxy: typeof item.proxy === 'string' ? item.proxy : '',
    certPath: typeof item.certPath === 'string' ? item.certPath : '',
    keyPath: typeof item.keyPath === 'string' ? item.keyPath : '',
  }
}

/** 当前请求要传给 api.http.exchange 的传输字段。 */
export function httpTransportOf(
  req: ApiRequest,
  interpolate: (text: string) => string,
): { timeoutMs: number; insecure: boolean; proxy?: string; certPath?: string; keyPath?: string } {
  const settings = req.settings
  const proxy = interpolate(settings?.proxy ?? '').trim()
  const certPath = interpolate(settings?.certPath ?? '').trim()
  const keyPath = interpolate(settings?.keyPath ?? '').trim()
  return {
    timeoutMs: timeoutMsOf(settings),
    insecure: req.insecureTLS === true,
    proxy: proxy || undefined,
    certPath: certPath || undefined,
    keyPath: keyPath || undefined,
  }
}
