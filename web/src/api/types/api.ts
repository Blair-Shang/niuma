/** API 发送历史 — 对应 Platform `nm_api_history`，不含集合文档。 */

export interface ApiHistoryListParams {
  workspaceId?: string
  requestId?: string
  limit?: number
}

export interface ApiHistoryEntry {
  historyId: string
  workspaceId: string
  requestId: string
  requestName: string
  httpMethod: string
  requestUrl: string
  environmentId: string
  environmentName: string
  requestJson: unknown
  exchangeJson: unknown
  durationMs: number
  httpStatus: number | null
  createdAt: string
}

export interface ApiHistoryListResult {
  entries: ApiHistoryEntry[]
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
  entry: ApiHistoryEntry
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
