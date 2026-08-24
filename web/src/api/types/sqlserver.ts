import type { ConnectionOptionsBase } from './connection'

export type SqlServerAuthType =
  | 'sql'
  | 'windows'
  | 'aad_password'
  | 'aad_integrated'
  | 'aad_msi'
  | 'aad_service_principal'

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
  /** 覆盖连接配置默认库，按查询 / DDL Tab 目标库建连 */
  database?: string
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
  resultSets?: SqlServerQueryResultSet[]
  /** routine.call：TDS OUTPUT 协议值 */
  outputs?: SqlServerRoutineOutput[]
  /** routine.call：存储过程 RETURN 状态 */
  returnValue?: number
}

export interface SqlServerRoutineOutput {
  name: string
  value: unknown
  dataType?: string
}

export interface SqlServerRoutineCallArg {
  ordinal?: number
  name: string
  mode?: string
  dataType?: string
  dtdIdentifier?: string
  value?: string
  isNull?: boolean
  hasDefault?: boolean
  isTableType?: boolean
  isCursor?: boolean
}

export interface SqlServerRoutineCallParams {
  sessionId: string
  database?: string
  schema: string
  name: string
  kind: 'procedure' | 'function'
  isTableValued?: boolean
  args: SqlServerRoutineCallArg[]
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface SqlServerQueryResultSet {
  columns?: SqlServerQueryColumn[]
  rows?: unknown[][]
  rowCount: number
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

/** `sqlserver.tree.*`：连接树懒加载（docs/32 §5.3） */
export interface SqlServerTreeListParams {
  profileId?: string
  sessionId?: string
  database?: string
  schema?: string
  filter?: string
  limit?: number
  excludeSystem?: boolean
  /** tree.tables：table | view | synonym */
  types?: string[]
  /** tree.routines：procedure | function */
  kinds?: string[]
}

export interface SqlServerDatabaseInfo {
  name: string
}

export interface SqlServerSchemaInfo {
  name: string
}

export interface SqlServerTableInfo {
  name: string
  type: string
}

export interface SqlServerRoutineInfo {
  name: string
  kind: string
}

export interface SqlServerSequenceInfo {
  name: string
}

export interface SqlServerTreeDatabasesResult {
  databases: SqlServerDatabaseInfo[]
  truncated?: boolean
}

export interface SqlServerTreeSchemasResult {
  schemas: SqlServerSchemaInfo[]
  truncated?: boolean
}

export interface SqlServerTreeTablesResult {
  tables: SqlServerTableInfo[]
  truncated?: boolean
}

export interface SqlServerTreeRoutinesResult {
  routines: SqlServerRoutineInfo[]
  truncated?: boolean
}

export interface SqlServerTreeSequencesResult {
  sequences: SqlServerSequenceInfo[]
  truncated?: boolean
}

export interface SqlServerTreeCategoryCountsResult {
  tables: number
  views: number
  procedures: number
  functions: number
  synonyms: number
  sequences: number
}

export interface SqlServerMetaRelationParams {
  profileId?: string
  sessionId?: string
  database?: string
  schema?: string
  name?: string
  table?: string
}

export interface SqlServerColumnInfo {
  ordinal: number
  name: string
  dataType: string
  nullable: boolean
  default?: string
  comment?: string
  autoIncrement?: boolean
  identitySeed?: string
  identityIncrement?: string
  computed?: boolean
  computedDefinition?: string
}

export interface SqlServerIndexInfo {
  name: string
  unique: boolean
  primary: boolean
  definition: string
  columns?: string[]
  method?: string
}

export interface SqlServerMetaColumnsResult {
  columns: SqlServerColumnInfo[]
  tableComment?: string
}

export interface SqlServerMetaIndexesResult {
  indexes: SqlServerIndexInfo[]
}

export interface SqlServerMetaPrimaryKeyResult {
  columns: string[]
}

export interface SqlServerMetaDDLResult {
  objectType: string
  ddl: string
}

export interface SqlServerMetaRoutineParams {
  profileId?: string
  sessionId?: string
  database?: string
  schema?: string
  name?: string
  kind?: 'procedure' | 'function' | 'sequence' | 'view'
}

export interface SqlServerMetaRoutineSourceResult {
  name: string
  schema?: string
  kind: string
  definition: string
}

export interface SqlServerRoutineParameter {
  ordinal: number
  name: string
  /** IN | OUTPUT；函数返回值伪行无 mode */
  mode: string
  dataType: string
  dtdIdentifier: string
  isReturn: boolean
  hasDefault?: boolean
  isTableType?: boolean
  isCursor?: boolean
}

export interface SqlServerMetaRoutineParametersResult {
  name: string
  schema?: string
  kind: string
  sysType?: string
  parameters: SqlServerRoutineParameter[]
  returnType?: string
  isTableValued?: boolean
}

export interface SqlServerQueryExplainParams {
  sessionId: string
  database?: string
  sql: string
  analyze?: boolean
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface SqlServerProcessInfo {
  sessionId: number
  loginName: string
  hostName?: string
  programName?: string
  status: string
  database?: string
  command?: string
  waitType?: string
  blockingSessionId?: number
  cpuTime: number
  elapsedMs: number
  loginTime?: string
  info?: string
}

export interface SqlServerMetaProcesslistParams {
  sessionId: string
}

export interface SqlServerMetaProcesslistResult {
  processes: SqlServerProcessInfo[]
}

export interface SqlServerMetaKillParams {
  sessionId: string
  id: number
}

export interface SqlServerMetaKillResult {
  killed: boolean
  id: number
}

export interface SqlServerCatalogListParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema?: string
  table?: string
  name?: string
  prefix?: string
  limit?: number
  excludeSystem?: boolean
  types?: string[]
}

export interface SqlServerCatalogSchemasResult {
  schemas: SqlServerSchemaInfo[]
  truncated?: boolean
}

export interface SqlServerCatalogTablesResult {
  tables: SqlServerTableInfo[]
  truncated?: boolean
}

export interface SqlServerCatalogColumnsResult {
  columns: SqlServerColumnInfo[]
  truncated?: boolean
}

export interface SqlServerForeignKeyInfo {
  name: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export interface SqlServerMetaForeignKeysResult {
  foreignKeys: SqlServerForeignKeyInfo[]
}

export interface SqlServerCheckInfo {
  name: string
  expression: string
}

export interface SqlServerMetaChecksResult {
  checks: SqlServerCheckInfo[]
}

export interface SqlServerDesignColumnSpec {
  name: string
  dataType: string
  nullable?: boolean
  default?: string | null
  comment?: string
  autoIncrement?: boolean
  primaryKey?: boolean
}

export interface SqlServerDesignIndexSpec {
  name?: string
  columns: string[]
  unique?: boolean
  primary?: boolean
  method?: string
}

export interface SqlServerDesignForeignKeySpec {
  name?: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export interface SqlServerDesignCheckSpec {
  name?: string
  expression: string
}

export type SqlServerDesignOp = {
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
  autoIncrement?: boolean
}

export interface SqlServerDdlDesignPreviewParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema: string
  name: string
  ops: SqlServerDesignOp[]
}

export interface SqlServerDdlDesignPreviewResult {
  sql: string[]
}

export interface SqlServerDdlDesignApplyParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema: string
  name: string
  ops: SqlServerDesignOp[]
}

export interface SqlServerDdlDesignApplyResult {
  sql: string[]
  durationMs?: number
}

export interface SqlServerDdlCreateTableParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema: string
  name: string
  columns: SqlServerDesignColumnSpec[]
  indexes?: SqlServerDesignIndexSpec[]
  foreignKeys?: SqlServerDesignForeignKeySpec[]
  checks?: SqlServerDesignCheckSpec[]
  comment?: string
}

export interface SqlServerDdlCreateTableResult {
  sql: string[]
  durationMs?: number
}

export interface SqlServerIoCsvOptions {
  header?: boolean
  delimiter?: string
  nullString?: string
  truncate?: boolean
  columnMap?: Record<string, string>
}

export type SqlServerIoDumpMode = 'structure_and_data' | 'structure_only' | 'data_only'

export interface SqlServerIoExportCsvParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema: string
  table: string
  outputPath: string
  csvOptions?: SqlServerIoCsvOptions
}

export interface SqlServerIoImportCsvParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema: string
  table: string
  inputPath: string
  csvOptions?: SqlServerIoCsvOptions
}

export interface SqlServerIoDumpSqlParams {
  sessionId?: string
  profileId?: string
  dump: {
    database: string
    schema?: string
    tables?: string[]
    mode: SqlServerIoDumpMode
    outputPath: string
    dropIfExists?: boolean
    truncateBeforeData?: boolean
    includeTables?: boolean
    includeViews?: boolean
    includeProcedures?: boolean
    includeFunctions?: boolean
    includeSynonyms?: boolean
    includeSequences?: boolean
    createSchema?: boolean
    excludeSystem?: boolean
  }
}

export interface SqlServerIoExecSqlFileParams {
  sessionId?: string
  profileId?: string
  database: string
  inputPath: string
  execOptions?: { continueOnError?: boolean }
}

export interface SqlServerIoTaskResult {
  taskId: string
}

export interface SqlServerIoCancelParams {
  profileId?: string
  sessionId?: string
  taskId: string
}

export interface SqlServerIoProgressEvent {
  type: string
  taskId: string
  phase: string
  message?: string
}

export interface SqlServerIoDoneEvent {
  type: string
  taskId: string
  ok: boolean
  message?: string
  outputPath?: string
}
