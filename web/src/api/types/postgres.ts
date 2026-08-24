import type { ConnectionOptionsBase } from './connection'

/** SSL 模式（libpq sslmode） */
export type PostgresSSLMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

/** PostgreSQL 连接选项（存于 connection_options JSON；snake_case）。 */
export interface PostgresConnectionOptions extends ConnectionOptionsBase {
  database: string
  ssl_mode: PostgresSSLMode
  ssl_root_cert?: string
  ssl_cert?: string
  ssl_key?: string
  search_path: string
  client_encoding?: string
  application_name: string
  connect_timeout_seconds: number
  statement_timeout_ms: number
  exclude_system_schemas: boolean
  /** @deprecated 优先 connect_timeout_seconds */
  timeout_seconds?: number
}

export const DEFAULT_POSTGRES_OPTIONS: PostgresConnectionOptions = {
  database: 'postgres',
  ssl_mode: 'prefer',
  ssl_root_cert: '',
  ssl_cert: '',
  ssl_key: '',
  search_path: '',
  client_encoding: 'UTF8',
  application_name: 'niuma-postgres',
  connect_timeout_seconds: 10,
  statement_timeout_ms: 0,
  exclude_system_schemas: true,
  proxy: { type: 'none' },
}

export interface PostgresDialectProfile {
  family: 'postgresql' | string
  version?: string
  versionNum?: string
  sqlCompatibility?: string
  capabilities: string[]
}

export interface PostgresSessionOpenParams {
  profileId: string
  /** 覆盖连接配置默认库，按查询 Tab 目标库建连（关自动提交时避免跨库短连） */
  database?: string
}
export interface PostgresSessionOpenResult {
  sessionId: string
  dialect?: PostgresDialectProfile
}
export interface PostgresSessionCloseParams {
  sessionId: string
}
export interface PostgresSessionTestParams {
  hostAddress?: string
  portNumber?: number
  loginAccount?: string
  profileId?: string
  options?: Partial<PostgresConnectionOptions>
}
export interface PostgresSessionTestResult {
  ok: boolean
  message: string
  version?: string
  dialect?: PostgresDialectProfile
}

export interface PostgresQueryColumn {
  name: string
  dataType?: string
  nullable?: boolean
  primaryKey?: boolean
}

export interface PostgresQueryExecParams {
  sessionId: string
  database?: string
  sql: string
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface PostgresQueryExecResult {
  requestId: string
  resultSetId?: string
  columns?: PostgresQueryColumn[]
  rows?: unknown[][]
  rowCount: number
  fetchedCount?: number
  hasMore?: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
  rowsAffected?: number
  /** RAISE NOTICE 等服务端通知（过程 OUT 经 DO 块读回） */
  notices?: string[]
}

export interface PostgresQueryExecBatchParams {
  sessionId: string
  database?: string
  statements: string[]
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface PostgresQueryExecBatchResult {
  requestId: string
  results: PostgresQueryExecResult[]
  notices?: string[]
  durationMs: number
}

export interface PostgresRoutineCallArg {
  name: string
  type: string
  mode: string
  value?: string
  isNull?: boolean
}

export interface PostgresRoutineCallParams {
  sessionId: string
  database?: string
  schema: string
  name: string
  args: PostgresRoutineCallArg[]
  requestId?: string
  timeoutMs?: number
}

export interface PostgresQueryFetchParams {
  sessionId: string
  resultSetId: string
  limit?: number
}
export interface PostgresQueryFetchResult {
  resultSetId?: string
  rows: unknown[][]
  rowCount: number
  fetchedCount: number
  hasMore: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
}

export interface PostgresQueryCloseParams {
  sessionId: string
  resultSetId?: string
}
export interface PostgresQueryCancelParams {
  sessionId: string
  requestId?: string
}

/** 会话事务 / Auto-commit 状态（对齐 MySQL / Navicat 工具栏）。 */
export interface PostgresTxState {
  autoCommit: boolean
  inTransaction: boolean
}

export interface PostgresTxSessionParams {
  sessionId: string
}

export interface PostgresTxSetAutoCommitParams {
  sessionId: string
  autoCommit: boolean
}

export interface PostgresQueryExplainParams {
  sessionId: string
  database?: string
  sql: string
  analyze?: boolean
  limit?: number
  timeoutMs?: number
  requestId?: string
}

/** 树列表通用过滤 */
export interface PostgresTreeListParams {
  profileId?: string
  sessionId?: string
  database?: string
  schema?: string
  filter?: string
  limit?: number
  excludeSystem?: boolean
  /** tree.tables：table / view / materialized_view / foreign_table */
  types?: string[]
  /** tree.routines：function / procedure */
  kinds?: string[]
}

export interface PostgresDatabaseInfo {
  name: string
}

export interface PostgresSchemaInfo {
  name: string
}

export interface PostgresTableInfo {
  name: string
  type: string
}

export interface PostgresRoutineInfo {
  oid?: number
  name: string
  kind: string
  args?: string
}

export interface PostgresSequenceInfo {
  name: string
}

export interface PostgresTreeDatabasesResult {
  databases: PostgresDatabaseInfo[]
  truncated?: boolean
}

export interface PostgresTreeSchemasResult {
  schemas: PostgresSchemaInfo[]
  truncated?: boolean
}

export interface PostgresTreeTablesResult {
  tables: PostgresTableInfo[]
  truncated?: boolean
}

export interface PostgresTreeRoutinesResult {
  routines: PostgresRoutineInfo[]
  truncated?: boolean
}

export interface PostgresTreeSequencesResult {
  sequences: PostgresSequenceInfo[]
  truncated?: boolean
}

export interface PostgresTreeCategoryCountsResult {
  tables: number
  views: number
  functions: number
  procedures: number
  sequences?: number
}

/** `postgres.catalog.*`：SQL 补全目录检索（docs/23 / docs/31） */
export interface PostgresCatalogListParams {
  sessionId: string
  database?: string
  schema?: string
  table?: string
  name?: string
  prefix?: string
  limit?: number
  excludeSystem?: boolean
  types?: string[]
}

export interface PostgresColumnInfo {
  ordinal: number
  name: string
  dataType: string
  nullable: boolean
  default?: string | null
  comment?: string
}

export interface PostgresCatalogSchemasResult {
  schemas: PostgresSchemaInfo[]
  truncated?: boolean
}

export interface PostgresCatalogTablesResult {
  tables: PostgresTableInfo[]
  truncated?: boolean
}

export interface PostgresCatalogColumnsResult {
  columns: PostgresColumnInfo[]
  truncated?: boolean
}

/** `postgres.meta.*` 关系定位 */
export interface PostgresMetaRelationParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema?: string
  name?: string
  table?: string
  args?: string
  oid?: number
  kind?: string
}

export interface PostgresIndexInfo {
  name: string
  unique: boolean
  primary: boolean
  definition: string
  columns?: string[]
  keyExpression?: string
  where?: string
  method?: string
}

export interface PostgresConstraintInfo {
  name: string
  type: string
  typeLabel: string
  definition: string
  expression?: string
}

export interface PostgresForeignKeyInfo {
  name: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export interface PostgresMetaColumnsResult {
  columns: PostgresColumnInfo[]
  tableComment?: string
}

export interface PostgresMetaIndexesResult {
  indexes: PostgresIndexInfo[]
}

export interface PostgresMetaConstraintsResult {
  constraints: PostgresConstraintInfo[]
}

export interface PostgresMetaDDLResult {
  objectType: string
  ddl: string
}

export interface PostgresMetaPrimaryKeyResult {
  columns: string[]
}

export interface PostgresMetaForeignKeysResult {
  foreignKeys: PostgresForeignKeyInfo[]
}

export interface PostgresDatabaseCreateOptionsResult {
  owners: string[]
  encodings: string[]
  templates: string[]
  collations: string[]
  defaultEncoding?: string
  defaultTemplate?: string
  defaultLcCollate?: string
  defaultLcCtype?: string
}

export interface PostgresDatabaseCreateOptionsParams {
  sessionId?: string
  profileId?: string
  encoding?: string
}

export interface PostgresMetaRoutineSourceResult {
  name: string
  kind: string
  args?: string
  definition: string
  oid?: number
}

export interface PostgresMetaInstanceOverviewResult {
  version: string
  versionNum?: string
  currentUser?: string
  currentDatabase?: string
  serverAddr?: string
  startTime?: string
  databaseCount: number
  activeBackends: number
  maxConnections?: number
}

export interface PostgresActivitySession {
  pid: number
  userName?: string
  database?: string
  state?: string
  waitEvent?: string
  waitEventType?: string
  clientAddr?: string
  clientPort?: number
  applicationName?: string
  query?: string
  durationMs?: number
  backendType?: string
  queryStart?: string
  xactStart?: string
  waiting?: boolean
  sessionId?: string
  queryId?: string
}

export interface PostgresMetaActivityResult {
  sessions: PostgresActivitySession[]
  truncated?: boolean
  limit?: number
}

export interface PostgresLockInfo {
  pid: number
  mode?: string
  granted: boolean
  relation?: string
  lockType?: string
  database?: string
  blockedByPid?: number
}

export interface PostgresLockBlockingEdge {
  blockedPid: number
  blockingPid: number
}

export interface PostgresMetaLocksResult {
  locks: PostgresLockInfo[]
  blocking?: PostgresLockBlockingEdge[]
  truncated?: boolean
  limit?: number
}

export interface PostgresMetaBackendActionResult {
  pid: number
  success: boolean
}

export interface PostgresServerKVItem {
  name: string
  value: string
}

export interface PostgresMetaServerKVParams {
  sessionId?: string
  profileId?: string
  database?: string
  like?: string
}

export interface PostgresMetaServerKVResult {
  items: PostgresServerKVItem[]
  truncated?: boolean
  limit?: number
}

export interface PostgresDesignOp {
  op: string
  name: string
  newName?: string
  dataType?: string
  default?: string | null
  nullable?: boolean
  comment?: string
  columns?: string[]
  unique?: boolean
  expression?: string
  where?: string
  method?: string
  refSchema?: string
  refTable?: string
  refColumns?: string[]
  onDelete?: string
  onUpdate?: string
}

export interface PostgresDesignParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema: string
  name: string
  ops: PostgresDesignOp[]
}

export interface PostgresDesignPreviewResult {
  sql: string[]
}

export interface PostgresDesignApplyResult {
  sql: string[]
  commandTags?: string[]
  durationMs: number
}

export interface PostgresCreateTableColumn {
  name: string
  dataType: string
  nullable: boolean
  default?: string | null
  primaryKey?: boolean
  comment?: string
}
export interface PostgresCreateTableIndex {
  name: string
  columns?: string[]
  expression?: string
  where?: string
  unique?: boolean
  method?: string
}
export interface PostgresCreateTableForeignKey {
  name?: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}
export interface PostgresCreateTableCheck {
  name?: string
  expression: string
}
export interface PostgresCreateTableParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema: string
  name: string
  columns: PostgresCreateTableColumn[]
  comment?: string
  indexes?: PostgresCreateTableIndex[]
  foreignKeys?: PostgresCreateTableForeignKey[]
  checks?: PostgresCreateTableCheck[]
}
export interface PostgresCreateTableResult {
  sql: string[]
  commandTags?: string[]
  durationMs?: number
}

/** 对齐 postgres-service/internal/ddl 白名单。 */
export type PostgresDdlAction =
  | 'truncate_table'
  | 'drop_table'
  | 'drop_view'
  | 'drop_function'
  | 'drop_procedure'
  | 'create_table'
  | 'create_view'
  | 'create_function'
  | 'create_procedure'
  | 'rename_table'
  | 'rename_view'
  | 'rename_function'
  | 'rename_procedure'
  | 'create_database'
  | 'rename_database'
  | 'drop_database'
  | 'create_schema'
  | 'rename_schema'
  | 'drop_schema'
  | 'alter_database_owner'
  | 'alter_schema_owner'
  | 'alter_function_owner'
  | 'alter_procedure_owner'

export interface PostgresDdlParams extends PostgresMetaRelationParams {
  args?: string
  oid?: number
  newName?: string
  owner?: string
  encoding?: string
  template?: string
  lcCollate?: string
  lcCtype?: string
  capabilities?: string[]
  action: PostgresDdlAction
}
export interface PostgresDdlScriptResult {
  action: string
  sql: string
  danger?: boolean
  summary?: string
}
export interface PostgresDdlExecResult {
  action: string
  commandTag?: string
  durationMs: number
}

export interface PostgresIoCsvOptions {
  header?: boolean
  delimiter?: string
  nullString?: string
  truncate?: boolean
  encoding?: string
}
export type PostgresIoDumpMode = 'structure_and_data' | 'structure_only' | 'data_only'
export interface PostgresIoDumpOptions {
  includeTables?: boolean
  includeViews?: boolean
  includeMatViews?: boolean
  includeSequences?: boolean
  includeFunctions?: boolean
  includeProcedures?: boolean
  includeTriggers?: boolean
  dropIfExists?: boolean
  truncateBeforeData?: boolean
  createSchema?: boolean
  excludeSystem?: boolean
}
export interface PostgresIoExecOptions {
  continueOnError?: boolean
}
export interface PostgresIoTaskResult {
  taskId: string
}
export interface PostgresIoCancelParams {
  /** 供 platform 凭据注入；io.cancel 本身不连库，但 credential_methods 含此方法时必传。 */
  profileId?: string
  sessionId?: string
  taskId: string
}
export interface PostgresIoProgressEvent {
  type: 'postgres.io.progress'
  taskId: string
  phase: string
  bytes?: number
  rows?: number
  message?: string
}
export interface PostgresIoDoneEvent {
  type: 'postgres.io.done'
  taskId: string
  ok: boolean
  message?: string
  outputPath?: string
}

/** SQL Language Server（Bridge 隧道 LSP） */
export interface PostgresLspOpenParams {
  sessionId: string
  clientId: string
  /** 编辑器当前 schema（协议字段名 database）；可空 */
  database?: string
}

export interface PostgresLspOpenResult {
  connectionId: string
}

export interface PostgresLspRpcParams {
  connectionId: string
  sessionId: string
  /** JSON-RPC 2.0 消息对象 */
  message: Record<string, unknown>
}

export interface PostgresLspRpcResult {
  ok?: boolean
  message?: Record<string, unknown>
}

export interface PostgresLspCloseParams {
  connectionId: string
  sessionId?: string
}

/** Monarch 高亮词表；可选 sessionId/compat 按兼容模式裁剪 */
export interface PostgresLspLexiconParams {
  sessionId?: string
  compat?: string
}

export interface PostgresLspLexiconResult {
  keywords: string[]
  functions: string[]
  compat?: string
}
