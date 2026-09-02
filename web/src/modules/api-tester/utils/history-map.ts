import type { ApiHistoryEntry } from '@/api/types/api'
import type { ApiExchange, ApiHistoryItem, ApiKvRow, ApiMethod, ApiRequest } from '../types'

const METHODS: readonly ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'WS', 'TCP', 'UDP']

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asKvRows(raw: unknown): ApiKvRow[] {
  if (!Array.isArray(raw)) return []
  return raw.map((row, index) => {
    const item = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    return {
      id: asText(item.id) || `kv-${index}`,
      enabled: item.enabled !== false,
      key: asText(item.key),
      value: asText(item.value),
    }
  })
}

function asMethod(value: unknown): ApiMethod {
  return METHODS.includes(value as ApiMethod) ? (value as ApiMethod) : 'GET'
}

/** 把库里的 request_json 还原成可打开的请求；缺字段则返回 null。 */
export function parseHistoryRequest(raw: unknown): ApiRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const name = asText(item.name).trim()
  if (!name) return null
  return {
    id: asText(item.id) || 'history-req',
    name,
    method: asMethod(item.method),
    url: asText(item.url),
    params: asKvRows(item.params),
    headers: asKvRows(item.headers),
    body: asText(item.body),
  }
}

/** 把库里的 exchange_json 还原成响应面板数据。 */
export function parseHistoryExchange(raw: unknown): ApiExchange | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  return {
    ok: item.ok === true,
    status: typeof item.status === 'number' ? item.status : null,
    statusText: asText(item.statusText),
    durationMs: typeof item.durationMs === 'number' ? item.durationMs : 0,
    sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : 0,
    protocol: asText(item.protocol) || 'HTTP/1.1',
    headers: asKvRows(item.headers),
    body: asText(item.body),
    hex: asText(item.hex) || undefined,
    error: asText(item.error) || undefined,
  }
}

export function toHistoryItem(entry: ApiHistoryEntry): ApiHistoryItem {
  return {
    historyId: entry.historyId,
    requestId: entry.requestId,
    requestName: entry.requestName,
    method: asMethod(entry.httpMethod),
    url: entry.requestUrl,
    environmentName: entry.environmentName,
    request: parseHistoryRequest(entry.requestJson),
    exchange: parseHistoryExchange(entry.exchangeJson),
    durationMs: entry.durationMs,
    httpStatus: entry.httpStatus,
    createdAt: entry.createdAt,
  }
}
