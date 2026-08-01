import type { ConnectionOptionsBase } from './connection'

export type OracleSSLMode = 'disable' | 'require'
export type OracleRole = 'normal' | 'sysdba' | 'sysoper'

export interface OracleConnectionOptions extends ConnectionOptionsBase {
  schema?: string
  service_name?: string
  sid?: string
  role?: OracleRole
  application_name?: string
  appName?: string
  exclude_system_schemas?: boolean
  connect_timeout_seconds?: number
  ssl_mode?: OracleSSLMode
  wallet_path?: string
  wallet_password?: string
}

export const DEFAULT_ORACLE_OPTIONS: OracleConnectionOptions = {
  schema: '',
  ssl_mode: 'disable',
  role: 'normal',
  exclude_system_schemas: true,
  connect_timeout_seconds: 30,
  application_name: 'NiuMa',
  proxy: { type: 'none' },
}

export interface OracleDialectProfile {
  family: 'oracle'
  version?: string
  versionNum?: string
  sqlCompatibility?: string
  capabilities: string[]
}

export interface OracleSessionOpenParams { profileId: string }
export interface OracleSessionOpenResult { sessionId: string; dialect?: OracleDialectProfile }
export interface OracleSessionCloseParams { sessionId: string }
export interface OracleSessionTestParams {
  hostAddress?: string
  portNumber?: number
  loginAccount?: string
  profileId?: string
  options?: Partial<OracleConnectionOptions>
}
export interface OracleSessionTestResult {
  ok: boolean
  message: string
  version?: string
  dialect?: OracleDialectProfile
}

export interface OracleQueryColumn { name: string; dataType?: string }
export interface OracleQueryExecParams {
  sessionId: string
  schema?: string
  sql: string
  limit?: number
  timeoutMs?: number
  requestId?: string
}
export interface OracleQueryExecResult {
  requestId: string
  resultSetId?: string
  columns?: OracleQueryColumn[]
  rows?: unknown[][]
  rowCount: number
  fetchedCount?: number
  hasMore?: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
  rowsAffected?: number
}
export interface OracleQueryFetchParams { sessionId: string; resultSetId: string; limit?: number }
export interface OracleQueryFetchResult {
  resultSetId?: string
  rows: unknown[][]
  rowCount: number
  fetchedCount: number
  hasMore: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
}
export interface OracleQueryCloseParams { sessionId: string; resultSetId?: string }
export interface OracleQueryCancelParams { sessionId: string; requestId?: string }

export interface OracleTreeListParams {
  profileId?: string
  sessionId?: string
  schema?: string
  filter?: string
  limit?: number
  excludeSystem?: boolean
  types?: string[]
}
export interface OracleSchemaInfo { name: string }
export interface OracleObjectInfo { name: string; type: string; schema?: string }
export interface OracleTreeSchemasResult { schemas: OracleSchemaInfo[]; truncated?: boolean }
export interface OracleTreeObjectsResult {
  objects?: OracleObjectInfo[]
  tables?: OracleObjectInfo[]
  routines?: OracleObjectInfo[]
  packages?: OracleObjectInfo[]
  sequences?: OracleObjectInfo[]
  truncated?: boolean
}
export interface OracleTreeCategoryCountsResult {
  tables: number
  views: number
  procedures: number
  functions: number
  packages: number
  sequences: number
}

export interface OracleCatalogListParams {
  sessionId: string
  schema?: string
  table?: string
  prefix?: string
  limit?: number
}
export interface OracleCatalogSchemasResult { schemas: Array<{ name: string }>; truncated?: boolean }
export interface OracleCatalogTablesResult {
  tables: Array<{ name: string; type?: string; schema?: string }>
  truncated?: boolean
}
export interface OracleCatalogColumnsResult {
  columns: Array<{ name: string; dataType?: string; schema?: string; table?: string }>
  truncated?: boolean
}

export interface OracleMetaRelationParams {
  sessionId: string
  schema?: string
  database?: string
  table?: string
  name?: string
}
export interface OracleColumnInfo {
  name: string
  dataType?: string
  nullable?: boolean
  default?: string | null
  ordinal?: number
  comment?: string
  /** IDENTITY / 自增列 */
  autoIncrement?: boolean
}
export interface OracleMetaColumnsResult { columns: OracleColumnInfo[]; tableComment?: string }
export interface OracleMetaDDLResult { ddl: string; objectType?: string }
export interface OracleMetaPrimaryKeyResult { columns: string[] }

export interface OracleIndexInfo {
  name: string
  unique: boolean
  primary: boolean
  definition?: string
  columns?: string[]
  method?: string
}

export interface OracleMetaIndexesResult {
  indexes: OracleIndexInfo[]
}

export interface OracleForeignKeyInfo {
  name: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export interface OracleMetaForeignKeysResult {
  foreignKeys: OracleForeignKeyInfo[]
}

export interface OracleMetaRoutineSourceParams {
  sessionId: string
  schema?: string
  name?: string
  routine?: string
  kind: 'procedure' | 'function'
}
export interface OracleMetaRoutineSourceResult {
  name: string
  kind: 'procedure' | 'function'
  definition: string
}
export interface OracleMetaPackageSourceParams {
  sessionId: string
  schema?: string
  name: string
  part?: 'spec' | 'body' | 'both'
}
export interface OracleMetaPackageSourceResult {
  name: string
  kind: 'package'
  definition: string
  bodyDefinition?: string
}

export interface OracleQueryExplainParams extends OracleQueryExecParams {
  analyze?: boolean
}
export interface OracleQueryLoadLobParams {
  sessionId: string
  schema?: string
  sql: string
  maxBytes?: number
}
export interface OracleQueryLoadLobResult {
  value: unknown
  truncated?: boolean
  type?: string
  byteLength?: number
}

export interface OracleProcessInfo {
  id: number
  serial?: number
  user: string
  host: string
  db?: string | null
  command: string
  time: number
  state?: string | null
  info?: string | null
}
export interface OracleMetaProcesslistParams { sessionId: string }
export interface OracleMetaProcesslistResult { processes: OracleProcessInfo[] }
export interface OracleMetaKillParams {
  sessionId: string
  id: number
  serial?: number
  queryOnly?: boolean
}
export interface OracleMetaKillResult { killed: boolean; id: number; queryOnly: boolean }
export interface OracleMetaInstanceOverviewParams { sessionId: string }
export interface OracleMetaInstanceOverviewResult {
  version: string
  versionComment?: string
  currentUser?: string
  currentDatabase?: string
  currentSchema?: string
  serverAddr?: string
  uptimeSeconds?: number
  databaseCount?: number
  schemaCount?: number
  threadsConnected?: number
  maxConnections?: number
  questions?: number
  slowQueries?: number
  statusPartial?: boolean
  warnings?: string[]
}
export interface OracleLockInfo {
  waitingPid: number
  blockingPid: number
  waitingUser?: string
  blockingUser?: string
  waitingQuery?: string
  lockType?: string
  lockMode?: string
  objectName?: string
  waitAgeSeconds?: number
}
export interface OracleMetaLocksParams { sessionId: string; limit?: number }
export interface OracleMetaLocksResult {
  locks: OracleLockInfo[]
  truncated?: boolean
  unavailable?: boolean
  message?: string
}

export interface OracleTxState {
  autoCommit: boolean
  inTransaction: boolean
}
export interface OracleTxSessionParams { sessionId: string }
export interface OracleTxSetAutoCommitParams { sessionId: string; autoCommit: boolean }

// ─── DDL: table design ──────────────────────────────────────────────────────

export interface OracleDesignColumnSpec {
  name: string
  dataType: string
  nullable?: boolean
  default?: string | null
  comment?: string
  autoIncrement?: boolean
  primaryKey?: boolean
}

export interface OracleDesignIndexSpec {
  name?: string
  columns: string[]
  unique?: boolean
  primary?: boolean
  method?: string
}

export interface OracleDesignForeignKeySpec {
  name?: string
  columns: string[]
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export type OracleDesignOp = {
  op: string
  name?: string
  newName?: string
  dataType?: string
  default?: string | null
  nullable?: boolean
  comment?: string
  columns?: string[]
  unique?: boolean
  method?: string
  refSchema?: string
  refTable?: string
  refColumns?: string[]
  onDelete?: string
  onUpdate?: string
}

export interface OracleDdlDesignPreviewParams {
  sessionId?: string
  schema: string
  name: string
  ops: OracleDesignOp[]
}

export interface OracleDdlDesignPreviewResult {
  sql: string[]
}

export interface OracleDdlDesignApplyParams {
  sessionId?: string
  schema: string
  name: string
  ops: OracleDesignOp[]
}

export interface OracleDdlDesignApplyResult {
  sql: string[]
  durationMs?: number
}

export interface OracleDdlCreateTableParams {
  sessionId?: string
  schema: string
  name: string
  columns: OracleDesignColumnSpec[]
  indexes?: OracleDesignIndexSpec[]
  foreignKeys?: OracleDesignForeignKeySpec[]
  comment?: string
}

export interface OracleDdlCreateTableResult {
  sql: string[]
  durationMs?: number
}

// ─── IO: import / export ────────────────────────────────────────────────────

export interface OracleIoCsvOptions {
  header?: boolean
  delimiter?: string
  nullString?: string
  truncate?: boolean
  columnMap?: Record<string, string>
}

export type OracleIoDumpMode = 'structure_and_data' | 'structure_only' | 'data_only'

export interface OracleIoExportCsvParams {
  sessionId?: string
  profileId?: string
  schema: string
  table: string
  outputPath: string
  csvOptions?: OracleIoCsvOptions
}

export interface OracleIoImportCsvParams {
  sessionId?: string
  profileId?: string
  schema: string
  table: string
  inputPath: string
  csvOptions?: OracleIoCsvOptions
}

export interface OracleIoDumpSqlParams {
  sessionId?: string
  profileId?: string
  dump: {
    schema: string
    tables?: string[]
    mode: OracleIoDumpMode
    outputPath: string
    dropIfExists?: boolean
    truncateBeforeData?: boolean
    includeTables?: boolean
    includeViews?: boolean
    includeProcedures?: boolean
    includeFunctions?: boolean
    includeSequences?: boolean
  }
}

export interface OracleIoExecSqlFileParams {
  sessionId?: string
  profileId?: string
  schema: string
  inputPath: string
  execOptions?: { continueOnError?: boolean }
}

export interface OracleIoTaskResult {
  taskId: string
}

export interface OracleIoCancelParams {
  sessionId?: string
  taskId: string
}

export interface OracleIoProgressEvent {
  type: string
  taskId: string
  phase: string
  message?: string
}

export interface OracleIoDoneEvent {
  type: string
  taskId: string
  ok: boolean
  message?: string
  outputPath?: string
}
