import type { ConnectionOptionsBase } from './connection'

export type SqlServerAuthType = 'sql'

export type SqlServerEncryptMode = 'optional' | 'disable' | 'mandatory' | 'strict'

export interface SqlServerConnectionOptions extends ConnectionOptionsBase {
  database?: string
  instance?: string
  auth_type?: SqlServerAuthType | string
  encrypt?: SqlServerEncryptMode | string
  trust_server_certificate?: boolean
  host_name_in_certificate?: string
  application_name?: string
  connect_timeout_seconds?: number
  /** @deprecated 兼容旧字段，优先 connect_timeout_seconds */
  timeout_seconds?: number
  exclude_system_schemas?: boolean
}

export const DEFAULT_SQLSERVER_OPTIONS: SqlServerConnectionOptions = {
  database: '',
  instance: '',
  auth_type: 'sql',
  encrypt: 'optional',
  application_name: 'NiuMa',
  connect_timeout_seconds: 10,
  exclude_system_schemas: true,
  proxy: { type: 'none' },
}

export interface SqlServerDialectProfile {
  family: 'sqlserver'
  version?: string
  versionNum?: string
  sqlCompatibility?: string
  capabilities: string[]
}

export interface SqlServerSessionOpenParams {
  profileId: string
}

export interface SqlServerSessionOpenResult {
  sessionId: string
  dialect?: SqlServerDialectProfile
}

export interface SqlServerSessionCloseParams {
  sessionId: string
}

export interface SqlServerSessionTestParams {
  hostAddress?: string
  portNumber?: number
  loginAccount?: string
  profileId?: string
  options?: Partial<SqlServerConnectionOptions>
}

export interface SqlServerSessionTestResult {
  ok: boolean
  message: string
  version?: string
  dialect?: SqlServerDialectProfile
}

export interface SqlServerQueryColumn {
  name: string
  dataType?: string
  nullable?: boolean
  length?: number
  precision?: number
  scale?: number
}

export interface SqlServerQueryExecParams {
  sessionId: string
  database?: string
  sql: string
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface SqlServerQueryExecResult {
  requestId: string
  resultSetId?: string
  columns?: SqlServerQueryColumn[]
  rows?: unknown[][]
  rowCount: number
  fetchedCount?: number
  hasMore?: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
  rowsAffected?: number
}

export interface SqlServerQueryFetchParams {
  sessionId: string
  resultSetId: string
  limit?: number
}

export interface SqlServerQueryFetchResult {
  resultSetId?: string
  rows: unknown[][]
  rowCount: number
  fetchedCount: number
  hasMore: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
}

export interface SqlServerQueryCloseParams {
  sessionId: string
  resultSetId?: string
}

export interface SqlServerQueryCancelParams {
  sessionId: string
  requestId?: string
}

/** SQL Language Server（Bridge 隧道 LSP） */
export interface SqlServerLspOpenParams {
  sessionId: string
  clientId: string
  /** 编辑器当前 database；可空 */
  database?: string
}

export interface SqlServerLspOpenResult {
  connectionId: string
}

export interface SqlServerLspRpcParams {
  connectionId: string
  sessionId: string
  message: Record<string, unknown>
}

export interface SqlServerLspRpcResult {
  ok?: boolean
  message?: Record<string, unknown>
}

export interface SqlServerLspCloseParams {
  connectionId: string
  sessionId?: string
}

export interface SqlServerLspLexiconParams {
  sessionId?: string
}

export interface SqlServerLspLexiconResult {
  keywords: string[]
  functions: string[]
}
