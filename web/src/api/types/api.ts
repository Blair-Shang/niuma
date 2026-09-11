/** API 发送历史 — 对应 Platform `nm_api_history`，不含集合文档。 */

export interface ApiHistoryListParams {
  workspaceId?: string
  requestId?: string
  limit?: number
}

export interface ApiHistorySummary {
  historyId: string
  workspaceId: string
  requestId: string
  requestName: string
  httpMethod: string
  requestUrl: string
  environmentId: string
  environmentName: string
  durationMs: number
  httpStatus: number | null
  createdAt: string
}

export interface ApiHistoryEntry extends ApiHistorySummary {
  requestJson?: unknown
  exchangeJson?: unknown
}

export interface ApiHistoryListResult {
  entries: ApiHistorySummary[]
}

export interface ApiHistoryGetParams {
  historyId: string
}

export interface ApiHistoryGetResult {
  entry: ApiHistoryEntry
}

export interface ApiHistoryAppendParams {
  workspaceId?: string
  requestId?: string
  requestName: string
  httpMethod: string
  requestUrl: string
  environmentId?: string
  environmentName?: string
  requestJson: unknown
  exchangeJson: unknown
  durationMs: number
  httpStatus?: number | null
}

export interface ApiHistoryAppendResult {
  entry: ApiHistorySummary
}

export interface ApiHistoryDeleteParams {
  historyId: string
}

export interface ApiHistoryDeleteResult {
  deleted: boolean
}

export interface ApiHistoryClearParams {
  workspaceId?: string
}

export interface ApiHistoryClearResult {
  cleared: boolean
}
