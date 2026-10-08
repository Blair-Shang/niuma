import type { ApiHistoryEntry, ApiHistorySummary } from '@/api/types/api'
import { asAuth, defaultAuth, parseBodyMode } from '../utils/collection-io'
import { normalizeGraphQL } from '../http/graphql/body'
import { normalizeHttpSettings } from '../http/settings/settings'
import { asCheckResults, asChecks, asPreSteps } from '../script/eval'
import type { ApiExchange, ApiHistoryItem, ApiKvRow, ApiMethod, ApiRequest } from '../types'

const METHODS: readonly ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'WS', 'TCP', 'UDP', 'GRPC']

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
      filePath: asText(item.filePath) || undefined,
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
  const body = asText(item.body)
  return {
    id: asText(item.id) || 'history-req',
    name,
    method: asMethod(item.method),
    url: asText(item.url),
    params: asKvRows(item.params),
    headers: asKvRows(item.headers),
    auth: item.auth ? asAuth(item.auth) : defaultAuth(),
    bodyMode: parseBodyMode(item.bodyMode) ?? (body.trim() ? 'json' : 'none'),
    body,
    bodyForm: asKvRows(item.bodyForm),
    graphql: normalizeGraphQL(item.graphql),
    insecureTLS: item.insecureTLS === true,
    settings: normalizeHttpSettings(item.settings),
    wsProtocols: asText(item.wsProtocols),
    preSteps: asPreSteps(item.preSteps),
    checks: asChecks(item.checks),
    preRequestScript: asText(item.preRequestScript),
    testScript: asText(item.testScript),
    grpcMethod: asText(item.grpcMethod),
  }
}

/** 历史快照缺 request_json 时，用列表摘要拼一条可保存的请求。 */
export function requestFromHistory(item: ApiHistoryItem, parsed: ApiRequest | null): ApiRequest | null {
  if (parsed) return parsed
  const name = item.requestName.trim()
  const url = item.url.trim()
  if (!name && !url) return null
  return {
    id: item.requestId || 'history-req',
    name: name || url,
    method: item.method,
    url,
    params: [],
    headers: [],
    auth: defaultAuth(),
    bodyMode: 'none',
    body: '',
    bodyForm: [],
    graphql: normalizeGraphQL(undefined),
    settings: normalizeHttpSettings(undefined),
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
    binary: item.binary === true || undefined,
    redirects: asRedirects(item.redirects),
    error: asText(item.error) || undefined,
    checks: asCheckResults(item.checks),
  }
}

function asRedirects(raw: unknown): { status: number; url: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const hops = raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const hop = item as Record<string, unknown>
    if (typeof hop.status !== 'number' || typeof hop.url !== 'string') return []
    return [{ status: hop.status, url: hop.url }]
  })
  return hops.length ? hops : undefined
}

export function toHistorySummary(entry: ApiHistorySummary): ApiHistoryItem {
  return {
    historyId: entry.historyId,
    requestId: entry.requestId,
    requestName: entry.requestName,
    method: asMethod(entry.httpMethod),
    url: entry.requestUrl,
    environmentName: entry.environmentName,
    request: null,
    exchange: null,
    durationMs: entry.durationMs,
    httpStatus: entry.httpStatus,
    createdAt: entry.createdAt,
  }
}

export function toHistoryItem(entry: ApiHistoryEntry): ApiHistoryItem {
  return {
    ...toHistorySummary(entry),
    request: parseHistoryRequest(entry.requestJson),
    exchange: parseHistoryExchange(entry.exchangeJson),
  }
}
