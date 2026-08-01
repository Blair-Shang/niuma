import type { ConnectionOptionsBase } from './connection'

export type DamengSSLMode = 'disable' | 'require' | 'verify-ca' | 'verify-full'

export interface DamengConnectionOptions extends ConnectionOptionsBase {
  schema?: string
  database?: string
  application_name?: string
  appName?: string
  ssl_mode?: DamengSSLMode
  ssl_ca?: string
  ssl_cert?: string
  ssl_key?: string
  exclude_system_schemas?: boolean
  connect_timeout_seconds?: number
}

export const DEFAULT_DAMENG_OPTIONS: DamengConnectionOptions = {
  schema: '',
  ssl_mode: 'disable',
  exclude_system_schemas: true,
  connect_timeout_seconds: 30,
  application_name: 'NiuMa',
  proxy: { type: 'none' },
}

export interface DamengDialectProfile {
  family: 'dameng'
  version?: string
  versionNum?: string
  sqlCompatibility?: string
  capabilities: string[]
}

export interface DamengSessionOpenParams { profileId: string }
export interface DamengSessionOpenResult { sessionId: string; dialect?: DamengDialectProfile }
export interface DamengSessionCloseParams { sessionId: string }
export interface DamengSessionTestParams {
  hostAddress?: string
  portNumber?: number
  loginAccount?: string
  profileId?: string
  options?: Partial<DamengConnectionOptions>
}
export interface DamengSessionTestResult {
  ok: boolean
  message: string
  version?: string
  dialect?: DamengDialectProfile
}

export interface DamengQueryColumn { name: string; dataType?: string }
export interface DamengQueryExecParams {
  sessionId: string
  schema?: string
  sql: string
  limit?: number
  timeoutMs?: number
  requestId?: string
}
export interface DamengQueryExecResult {
  requestId: string
  resultSetId?: string
  columns?: DamengQueryColumn[]
  rows?: unknown[][]
  rowCount: number
  fetchedCount?: number
  hasMore?: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
  rowsAffected?: number
}
export interface DamengQueryFetchParams { sessionId: string; resultSetId: string; limit?: number }
export interface DamengQueryFetchResult {
  resultSetId?: string
  rows: unknown[][]
  rowCount: number
  fetchedCount: number
  hasMore: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
}
export interface DamengQueryCloseParams { sessionId: string; resultSetId?: string }
export interface DamengQueryCancelParams { sessionId: string; requestId?: string }

export interface DamengTreeListParams {
  profileId?: string
  sessionId?: string
  schema?: string
  filter?: string
  limit?: number
  excludeSystem?: boolean
  types?: string[]
}
export interface DamengSchemaInfo { name: string }
export interface DamengObjectInfo { name: string; type: string; schema?: string }
export interface DamengTreeSchemasResult { schemas: DamengSchemaInfo[]; truncated?: boolean }
export interface DamengTreeObjectsResult {
  objects?: DamengObjectInfo[]
  tables?: DamengObjectInfo[]
  routines?: DamengObjectInfo[]
  sequences?: DamengObjectInfo[]
  truncated?: boolean
}

export interface DamengTxState {
  autoCommit: boolean
  inTransaction: boolean
}
export interface DamengTxSessionParams { sessionId: string }
export interface DamengTxSetAutoCommitParams { sessionId: string; autoCommit: boolean }
export interface DamengTreeCategoryCountsResult {
  tables: number
  views: number
  procedures: number
  functions: number
  packages?: number
  synonyms?: number
  triggers?: number
  sequences: number
}

export interface DamengCatalogListParams {
  sessionId: string
  schema?: string
  table?: string
  prefix?: string
  limit?: number
}
export interface DamengCatalogSchemasResult { schemas: Array<{ name: string }>; truncated?: boolean }
export interface DamengCatalogTablesResult {
  tables: Array<{ name: string; type?: string; schema?: string }>
  truncated?: boolean
}
export interface DamengCatalogColumnsResult {
  columns: Array<{ name: string; dataType?: string; schema?: string; table?: string }>
  truncated?: boolean
}

export interface DamengMetaRelationParams {
  sessionId?: string
  profileId?: string
  schema?: string
  /** 兼容别名：当作 schema */
  database?: string
  table?: string
  name?: string
}

export interface DamengMetaRoutineParams {
  sessionId: string
  schema?: string
  database?: string
  name?: string
  routine?: string
  kind: 'procedure' | 'function'
}

export interface DamengMetaRoutineSourceResult {
  name: string
  kind: string
  definition: string
}

export interface DamengRoutineParameter {
  ordinal: number
  name: string
  /** IN | OUT | INOUT；返回值伪行无 mode */
  mode: string
  dataType: string
  dtdIdentifier: string
  isReturn: boolean
}

export interface DamengMetaRoutineParametersResult {
  name: string
  kind: string
  parameters: DamengRoutineParameter[]
  returnType?: string
}

export interface DamengColumnInfo {
  name: string
  dataType?: string
  nullable?: boolean
  default?: string | null
  ordinal?: number
  comment?: string
  /** IDENTITY / 自增列 */
  autoIncrement?: boolean
}
export interface DamengMetaColumnsResult { columns: DamengColumnInfo[]; tableComment?: string }
export interface DamengMetaDDLResult { ddl: string; objectType?: string }
export interface DamengMetaPrimaryKeyResult { columns: string[] }

export interface DamengIndexInfo {
  name: string
  unique: boolean
  primary: boolean
  definition?: string
  columns?: string[]
  method?: string
}

export interface DamengMetaIndexesResult {
  indexes: DamengIndexInfo[]
}

export interface DamengForeignKeyInfo {
  name: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export interface DamengMetaForeignKeysResult {
  foreignKeys: DamengForeignKeyInfo[]
}

export interface DamengCheckInfo {
  name: string
  expression: string
}

export interface DamengMetaChecksResult {
  checks: DamengCheckInfo[]
}

export interface DamengQueryExplainParams {
  sessionId: string
  schema?: string
  sql: string
  analyze?: boolean
  limit?: number
  timeoutMs?: number
  requestId?: string
}

/** 进程列表 */
export interface DamengProcessInfo {
  id: number
  user: string
  host: string
  /** 当前 schema / 库名（字段名对齐 MySQL processlist.db） */
  db?: string | null
  command: string
  time: number
  state?: string | null
  info?: string | null
}

export interface DamengMetaProcesslistParams {
  sessionId: string
}

export interface DamengMetaProcesslistResult {
  processes: DamengProcessInfo[]
}

export interface DamengMetaKillParams {
  sessionId: string
  id: number
  /** 达梦不支持仅取消语句；传 true 会返回错误。省略或 false = SP_CLOSE_SESSION。 */
  queryOnly?: boolean
}

export interface DamengMetaKillResult {
  killed: boolean
  id: number
  queryOnly: boolean
}

export interface DamengMetaInstanceOverviewParams {
  sessionId: string
}

export interface DamengMetaInstanceOverviewResult {
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

export interface DamengLockInfo {
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

export interface DamengMetaLocksParams {
  sessionId: string
  limit?: number
}

export interface DamengMetaLocksResult {
  locks: DamengLockInfo[]
  truncated?: boolean
  limit?: number
  unavailable?: boolean
  message?: string
}

// ─── DDL: table design（ops JSON 对齐 MySQL TableDesign）──────────────────

export interface DamengDesignColumnSpec {
  name: string
  dataType: string
  nullable?: boolean
  default?: string | null
  comment?: string
  autoIncrement?: boolean
  primaryKey?: boolean
}

export interface DamengDesignIndexSpec {
  name?: string
  columns: string[]
  unique?: boolean
  primary?: boolean
  method?: string
}

export interface DamengDesignForeignKeySpec {
  name?: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export interface DamengDesignCheckSpec {
  name?: string
  expression: string
}

export type DamengDesignOp = {
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
  expression?: string
  refSchema?: string
  refTable?: string
  refColumns?: string[]
  onDelete?: string
  onUpdate?: string
}

export interface DamengDdlDesignPreviewParams {
  sessionId?: string
  schema: string
  name: string
  ops: DamengDesignOp[]
}

export interface DamengDdlDesignPreviewResult {
  sql: string[]
}

export interface DamengDdlDesignApplyParams {
  sessionId?: string
  schema: string
  name: string
  ops: DamengDesignOp[]
}

export interface DamengDdlDesignApplyResult {
  sql: string[]
  durationMs?: number
}

export interface DamengDdlCreateTableParams {
  sessionId?: string
  schema: string
  name: string
  columns: DamengDesignColumnSpec[]
  indexes?: DamengDesignIndexSpec[]
  foreignKeys?: DamengDesignForeignKeySpec[]
  checks?: DamengDesignCheckSpec[]
  comment?: string
}

export interface DamengDdlCreateTableResult {
  sql: string[]
  durationMs?: number
}

// ─── IO: import / export ────────────────────────────────────────────────────

export interface DamengIoCsvOptions {
  header?: boolean
  delimiter?: string
  nullString?: string
  truncate?: boolean
  columnMap?: Record<string, string>
}

export type DamengIoDumpMode = 'structure_and_data' | 'structure_only' | 'data_only'

export interface DamengIoExportCsvParams {
  sessionId?: string
  profileId?: string
  schema: string
  table: string
  outputPath: string
  csvOptions?: DamengIoCsvOptions
}

export interface DamengIoImportCsvParams {
  sessionId?: string
  profileId?: string
  schema: string
  table: string
  inputPath: string
  csvOptions?: DamengIoCsvOptions
}

export interface DamengIoDumpSqlParams {
  sessionId?: string
  profileId?: string
  dump: {
    schema: string
    tables?: string[]
    mode: DamengIoDumpMode
    outputPath: string
    dropIfExists?: boolean
    truncateBeforeData?: boolean
    includeTables?: boolean
    includeViews?: boolean
    includeProcedures?: boolean
    includeFunctions?: boolean
    includePackages?: boolean
    includeSynonyms?: boolean
    includeTriggers?: boolean
    includeSequences?: boolean
  }
}

export interface DamengIoExecSqlFileParams {
  sessionId?: string
  profileId?: string
  schema: string
  inputPath: string
  execOptions?: { continueOnError?: boolean }
}

export interface DamengIoTaskResult {
  taskId: string
}

export interface DamengIoCancelParams {
  /** 供 platform 凭据注入；io.cancel 本身不连库，但 credential_methods 含此方法时必传。 */
  profileId?: string
  sessionId?: string
  taskId: string
}

export interface DamengIoProgressEvent {
  type: string
  taskId: string
  phase: string
  message?: string
}

export interface DamengIoDoneEvent {
  type: string
  taskId: string
  ok: boolean
  message?: string
  outputPath?: string
}

/** SQL Language Server（Bridge 隧道 LSP） */
export interface DamengLspOpenParams {
  sessionId: string
  clientId: string
  /** 编辑器当前 schema（协议字段名 database）；可空 */
  database?: string
}

export interface DamengLspOpenResult {
  connectionId: string
}

export interface DamengLspRpcParams {
  connectionId: string
  sessionId: string
  /** JSON-RPC 2.0 消息对象 */
  message: Record<string, unknown>
}

export interface DamengLspRpcResult {
  ok?: boolean
  message?: Record<string, unknown>
}

export interface DamengLspCloseParams {
  connectionId: string
  sessionId?: string
}

/** Monarch 高亮词表；可选 sessionId/compat 按兼容模式裁剪 */
export interface DamengLspLexiconParams {
  sessionId?: string
  compat?: string
}

export interface DamengLspLexiconResult {
  keywords: string[]
  functions: string[]
  compat?: string
}
