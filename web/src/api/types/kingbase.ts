import type { ConnectionOptionsBase } from './connection'

/** SSL 模式（libpq sslmode） */
export type KingbaseSSLMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

/** KingbaseES 连接选项（存于 connection_options JSON；snake_case）。 */
export interface KingbaseConnectionOptions extends ConnectionOptionsBase {
  database: string
  ssl_mode: KingbaseSSLMode
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

export const DEFAULT_KINGBASE_OPTIONS: KingbaseConnectionOptions = {
  database: 'TEST',
  ssl_mode: 'prefer',
  ssl_root_cert: '',
  ssl_cert: '',
  ssl_key: '',
  search_path: '',
  client_encoding: 'UTF8',
  application_name: 'niuma-kingbase',
  connect_timeout_seconds: 10,
  statement_timeout_ms: 0,
  exclude_system_schemas: true,
  proxy: { type: 'none' },
}

export interface KingbaseDialectProfile {
  family: 'kingbase' | string
  version?: string
  versionNum?: string
  sqlCompatibility?: string
  capabilities: string[]
}

export interface KingbaseSessionOpenParams {
  profileId: string
  /** 覆盖连接配置默认库，按查询 Tab 目标库建连（关自动提交时避免跨库短连） */
  database?: string
}
export interface KingbaseSessionOpenResult {
  sessionId: string
  dialect?: KingbaseDialectProfile
}
export interface KingbaseSessionCloseParams {
  sessionId: string
}
export interface KingbaseSessionTestParams {
  hostAddress?: string
  portNumber?: number
  loginAccount?: string
  profileId?: string
  options?: Partial<KingbaseConnectionOptions>
}
export interface KingbaseSessionTestResult {
  ok: boolean
  message: string
  version?: string
  dialect?: KingbaseDialectProfile
}

export interface KingbaseQueryColumn {
  name: string
  dataType?: string
  nullable?: boolean
  primaryKey?: boolean
}

export interface KingbaseQueryExecParams {
  sessionId: string
  database?: string
  sql: string
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface KingbaseQueryExecResult {
  requestId: string
  resultSetId?: string
  columns?: KingbaseQueryColumn[]
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

export interface KingbaseQueryExecBatchParams {
  sessionId: string
  database?: string
  statements: string[]
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface KingbaseQueryExecBatchResult {
  requestId: string
  results: KingbaseQueryExecResult[]
  notices?: string[]
  durationMs: number
}

export interface KingbaseRoutineCallArg {
  name: string
  type: string
  mode: string
  value?: string
  isNull?: boolean
}

export interface KingbaseRoutineCallParams {
  sessionId: string
  database?: string
  schema: string
  name: string
  args: KingbaseRoutineCallArg[]
  requestId?: string
  timeoutMs?: number
}

export interface KingbaseQueryFetchParams {
  sessionId: string
  resultSetId: string
  limit?: number
}
export interface KingbaseQueryFetchResult {
  resultSetId?: string
  rows: unknown[][]
  rowCount: number
  fetchedCount: number
  hasMore: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
}

export interface KingbaseQueryCloseParams {
  sessionId: string
  resultSetId?: string
}
export interface KingbaseQueryCancelParams {
  sessionId: string
  requestId?: string
}

/** 会话事务 / Auto-commit 状态（对齐 MySQL / Navicat 工具栏）。 */
export interface KingbaseTxState {
  autoCommit: boolean
  inTransaction: boolean
}

export interface KingbaseTxSessionParams {
  sessionId: string
}

export interface KingbaseTxSetAutoCommitParams {
  sessionId: string
  autoCommit: boolean
}

export interface KingbaseQueryExplainParams {
  sessionId: string
  database?: string
  sql: string
  analyze?: boolean
  limit?: number
  timeoutMs?: number
  requestId?: string
}

/** 树列表通用过滤 */
export interface KingbaseTreeListParams {
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

export interface KingbaseDatabaseInfo {
  name: string
}

export interface KingbaseSchemaInfo {
  name: string
}

export interface KingbaseTableInfo {
  name: string
  type: string
}

export interface KingbaseRoutineInfo {
  oid?: number
  name: string
  kind: string
  args?: string
}

export interface KingbaseSequenceInfo {
  name: string
}

export interface KingbaseTreeDatabasesResult {
  databases: KingbaseDatabaseInfo[]
  truncated?: boolean
}

export interface KingbaseTreeSchemasResult {
  schemas: KingbaseSchemaInfo[]
  truncated?: boolean
}

export interface KingbaseTreeTablesResult {
  tables: KingbaseTableInfo[]
  truncated?: boolean
}

export interface KingbaseTreeRoutinesResult {
  routines: KingbaseRoutineInfo[]
  truncated?: boolean
}

export interface KingbaseTreeSequencesResult {
  sequences: KingbaseSequenceInfo[]
  truncated?: boolean
}

export interface KingbaseTreeCategoryCountsResult {
  tables: number
  views: number
  functions: number
  procedures: number
  sequences?: number
}

/** `kingbase.catalog.*`：SQL 补全目录检索（docs/23 / docs/31） */
export interface KingbaseCatalogListParams {
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

export interface KingbaseColumnInfo {
  ordinal: number
  name: string
  dataType: string
  nullable: boolean
  default?: string | null
  comment?: string
}

export interface KingbaseCatalogSchemasResult {
  schemas: KingbaseSchemaInfo[]
  truncated?: boolean
}

export interface KingbaseCatalogTablesResult {
  tables: KingbaseTableInfo[]
  truncated?: boolean
}

export interface KingbaseCatalogColumnsResult {
  columns: KingbaseColumnInfo[]
  truncated?: boolean
}

/** `kingbase.meta.*` 关系定位 */
export interface KingbaseMetaRelationParams {
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

export interface KingbaseIndexInfo {
  name: string
  unique: boolean
  primary: boolean
  definition: string
  columns?: string[]
  keyExpression?: string
  where?: string
  method?: string
}

export interface KingbaseConstraintInfo {
  name: string
  type: string
  typeLabel: string
  definition: string
  expression?: string
}

export interface KingbaseForeignKeyInfo {
  name: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export interface KingbaseMetaColumnsResult {
  columns: KingbaseColumnInfo[]
  tableComment?: string
}

export interface KingbaseMetaIndexesResult {
  indexes: KingbaseIndexInfo[]
}

export interface KingbaseMetaConstraintsResult {
  constraints: KingbaseConstraintInfo[]
}

export interface KingbaseMetaDDLResult {
  objectType: string
  ddl: string
}

export interface KingbaseMetaPrimaryKeyResult {
  columns: string[]
}

export interface KingbaseMetaForeignKeysResult {
  foreignKeys: KingbaseForeignKeyInfo[]
}

export interface KingbaseDatabaseCreateOptionsResult {
  owners: string[]
  encodings: string[]
  templates: string[]
  collations: string[]
  defaultEncoding?: string
  defaultTemplate?: string
  defaultLcCollate?: string
  defaultLcCtype?: string
}

export interface KingbaseDatabaseCreateOptionsParams {
  sessionId?: string
  profileId?: string
  encoding?: string
}

export interface KingbaseMetaRoutineSourceResult {
  name: string
  kind: string
  args?: string
  definition: string
  oid?: number
}

export interface KingbaseMetaInstanceOverviewResult {
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

export interface KingbaseActivitySession {
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

export interface KingbaseMetaActivityResult {
  sessions: KingbaseActivitySession[]
  truncated?: boolean
  limit?: number
}

export interface KingbaseLockInfo {
  pid: number
  mode?: string
  granted: boolean
  relation?: string
  lockType?: string
  database?: string
  blockedByPid?: number
}

export interface KingbaseLockBlockingEdge {
  blockedPid: number
  blockingPid: number
}

export interface KingbaseMetaLocksResult {
  locks: KingbaseLockInfo[]
  blocking?: KingbaseLockBlockingEdge[]
  truncated?: boolean
  limit?: number
}

export interface KingbaseMetaBackendActionResult {
  pid: number
  success: boolean
}

export interface KingbaseServerKVItem {
  name: string
  value: string
}

export interface KingbaseMetaServerKVParams {
  sessionId?: string
  profileId?: string
  database?: string
  like?: string
}

export interface KingbaseMetaServerKVResult {
  items: KingbaseServerKVItem[]
  truncated?: boolean
  limit?: number
}

export interface KingbaseDesignOp {
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

export interface KingbaseDesignParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema: string
  name: string
  ops: KingbaseDesignOp[]
}

export interface KingbaseDesignPreviewResult {
  sql: string[]
}

export interface KingbaseDesignApplyResult {
  sql: string[]
  commandTags?: string[]
  durationMs: number
}

export interface KingbaseCreateTableColumn {
  name: string
  dataType: string
  nullable: boolean
  default?: string | null
  primaryKey?: boolean
  comment?: string
}
export interface KingbaseCreateTableIndex {
  name: string
  columns?: string[]
  expression?: string
  where?: string
  unique?: boolean
  method?: string
}
export interface KingbaseCreateTableForeignKey {
  name?: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}
export interface KingbaseCreateTableCheck {
  name?: string
  expression: string
}
export interface KingbaseCreateTableParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema: string
  name: string
  columns: KingbaseCreateTableColumn[]
  comment?: string
  indexes?: KingbaseCreateTableIndex[]
  foreignKeys?: KingbaseCreateTableForeignKey[]
  checks?: KingbaseCreateTableCheck[]
}
export interface KingbaseCreateTableResult {
  sql: string[]
  commandTags?: string[]
  durationMs?: number
}

/** 对齐 kingbase-service/internal/ddl 白名单。 */
export type KingbaseDdlAction =
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

export interface KingbaseDdlParams extends KingbaseMetaRelationParams {
  args?: string
  oid?: number
  newName?: string
  owner?: string
  encoding?: string
  template?: string
  lcCollate?: string
  lcCtype?: string
  capabilities?: string[]
  action: KingbaseDdlAction
}
export interface KingbaseDdlScriptResult {
  action: string
  sql: string
  danger?: boolean
  summary?: string
}
export interface KingbaseDdlExecResult {
  action: string
  commandTag?: string
  durationMs: number
}

export interface KingbaseIoCsvOptions {
  header?: boolean
  delimiter?: string
  nullString?: string
  truncate?: boolean
  encoding?: string
}
export type KingbaseIoDumpMode = 'structure_and_data' | 'structure_only' | 'data_only'
export interface KingbaseIoDumpOptions {
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
export interface KingbaseIoExecOptions {
  continueOnError?: boolean
}
export interface KingbaseIoTaskResult {
  taskId: string
}
export interface KingbaseIoCancelParams {
  /** 供 platform 凭据注入；io.cancel 本身不连库，但 credential_methods 含此方法时必传。 */
  profileId?: string
  sessionId?: string
  taskId: string
}
export interface KingbaseIoProgressEvent {
  type: 'kingbase.io.progress'
  taskId: string
  phase: string
  bytes?: number
  rows?: number
  message?: string
}
export interface KingbaseIoDoneEvent {
  type: 'kingbase.io.done'
  taskId: string
  ok: boolean
  message?: string
  outputPath?: string
}

/** SQL Language Server（Bridge 隧道 LSP） */
export interface KingbaseLspOpenParams {
  sessionId: string
  clientId: string
  /** 编辑器当前 schema（协议字段名 database）；可空 */
  database?: string
}

export interface KingbaseLspOpenResult {
  connectionId: string
}

export interface KingbaseLspRpcParams {
  connectionId: string
  sessionId: string
  /** JSON-RPC 2.0 消息对象 */
  message: Record<string, unknown>
}

export interface KingbaseLspRpcResult {
  ok?: boolean
  message?: Record<string, unknown>
}

export interface KingbaseLspCloseParams {
  connectionId: string
  sessionId?: string
}

/** Monarch 高亮词表；可选 sessionId/compat 按兼容模式裁剪 */
export interface KingbaseLspLexiconParams {
  sessionId?: string
  compat?: string
}

export interface KingbaseLspLexiconResult {
  keywords: string[]
  functions: string[]
  compat?: string
}
