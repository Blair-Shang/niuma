/**
 * 把一条请求收成 ws.connect 参数。变量在调用前已经展开。
 */
import type { ApiRequest } from '../../types'
import { timeoutMsOf } from '../../http/settings/settings'
import { parseWebSocketURL, splitProtocols } from './url'

export interface WsConnectDraft {
  url: string
  host: string
  port: number
  headers: { name: string; value: string }[]
  protocols: string[]
  insecure: boolean
  proxy?: string
  certPath?: string
  keyPath?: string
  timeoutMs: number
}

export function buildWebSocketDraft(
  req: ApiRequest,
  interpolate: (text: string) => string,
): WsConnectDraft {
  const located = parseWebSocketURL(interpolate(req.url))
  const proxy = interpolate(req.settings?.proxy ?? '').trim()
  const certPath = interpolate(req.settings?.certPath ?? '').trim()
  const keyPath = interpolate(req.settings?.keyPath ?? '').trim()
  return {
    url: located.url,
    host: located.host,
    port: located.port,
    headers: req.headers
      .filter((row) => row.enabled && row.key.trim())
      .map((row) => ({ name: row.key.trim(), value: interpolate(row.value) })),
    protocols: splitProtocols(interpolate(req.wsProtocols ?? '')),
    insecure: req.insecureTLS === true,
    proxy: proxy || undefined,
    certPath: certPath || undefined,
    keyPath: keyPath || undefined,
    timeoutMs: timeoutMsOf(req.settings),
  }
}
