/**
 * SQLite 能力类型 —— `sqlite.*` Bridge 契约（对应 `services/sqlite-service`）。
 * 见 docs/27-sqlite-module.md。
 */
import type { ConnectionOptionsBase } from './connection'

/** 打开连接后执行的 ATTACH DATABASE 条目 */
export interface SqliteAttachEntry {
  alias: string
  filePath: string
  readOnly?: boolean
}

/** SQLite 连接选项（存于 connection_options JSON） */
export interface SqliteConnectionOptions extends ConnectionOptionsBase {
  /** 数据库文件绝对路径 */
  filePath: string
  /** 只读打开 */
  readOnly?: boolean
  /** 文件不存在时创建 */
  createIfMissing?: boolean
  busyTimeoutMs?: number
  /** WAL / DELETE / …；空表示不改 */
  journalMode?: string
  foreignKeys?: boolean
  /** 对象树是否隐藏 sqlite_* */
  exclude_system_schemas?: boolean
  connect_timeout_seconds?: number
  /** 建连后 ATTACH 的附加库列表 */
  attach?: SqliteAttachEntry[]
}

export const DEFAULT_SQLITE_OPTIONS: SqliteConnectionOptions = {
  filePath: '',
  readOnly: false,
  createIfMissing: false,
  busyTimeoutMs: 5000,
  journalMode: '',
  foreignKeys: true,
  exclude_system_schemas: true,
  connect_timeout_seconds: 10,
  proxy: { type: 'none' },
}

export interface SqliteDialectProfile {
  family: string
  version?: string
  versionNum?: string
  sqlCompatibility?: string
  capabilities: string[]
}

export interface SqliteSessionOpenParams {
  profileId: string
}

export interface SqliteSessionOpenResult {
  sessionId: string
  dialect?: SqliteDialectProfile
}

export interface SqliteSessionCloseParams {
  sessionId: string
}

export interface SqliteSessionTestParams {
  /** platform 内联测试必填：文件型协议填数据库绝对路径 */
  hostAddress?: string
  filePath?: string
  path?: string
  secret?: string
  password?: string
  profileId?: string
  options?: Partial<SqliteConnectionOptions>
}

export interface SqliteSessionTestResult {
  ok: boolean
  message: string
  version?: string
  dialect?: SqliteDialectProfile
}

export interface SqliteQueryColumn {
  name: string
  dataType?: string
}

export interface SqliteQueryExecParams {
  sessionId: string
  schema?: string
  sql: string
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface SqliteQueryExecResult {
  requestId: string
  resultSetId?: string
  columns?: SqliteQueryColumn[]
  rows?: unknown[][]
  rowCount: number
  fetchedCount?: number
  hasMore?: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
  rowsAffected?: number
}

export interface SqliteQueryFetchParams {
  sessionId: string
  resultSetId: string
  limit?: number
}

export interface SqliteQueryFetchResult {
  resultSetId?: string
  rows: unknown[][]
  rowCount: number
  fetchedCount: number
  hasMore: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
}

export interface SqliteQueryCancelParams {
  sessionId: string
  requestId?: string
}

export interface SqliteQueryCloseParams {
  sessionId: string
  resultSetId?: string
}

export interface SqliteQueryExplainParams {
  sessionId: string
  sql: string
  timeoutMs?: number
}

export interface SqliteTreeListParams {
  profileId?: string
  sessionId?: string
  schema?: string
  database?: string
  filter?: string
  limit?: number
  excludeSystem?: boolean
  types?: string[]
}

export interface SqliteSchemaInfo {
  name: string
  /** PRAGMA database_list.file */
  file?: string
  seq?: number
}

export interface SqliteObjectInfo {
  name: string
  type: string
  table?: string
  schema?: string
}

export interface SqliteTreeSchemasResult {
  schemas: SqliteSchemaInfo[]
  truncated?: boolean
}

export interface SqliteTreeObjectsResult {
  objects?: SqliteObjectInfo[]
  tables?: SqliteObjectInfo[]
  truncated?: boolean
}

export interface SqliteTreeCategoryCountsResult {
  tables: number
  views: number
  indexes: number
  triggers: number
}

export interface SqliteCatalogListParams {
  sessionId: string
  schema?: string
  database?: string
  table?: string
  name?: string
  prefix?: string
  limit?: number
  excludeSystem?: boolean
  types?: string[]
}

export interface SqliteCatalogSchemasResult {
  schemas: Array<{ name: string }>
  truncated?: boolean
}

export interface SqliteCatalogTablesResult {
  tables: Array<{ name: string; type?: string; schema?: string }>
  truncated?: boolean
}

export interface SqliteCatalogColumnsResult {
  columns: Array<{ name: string; dataType?: string; schema?: string; table?: string }>
  truncated?: boolean
}

export interface SqliteMetaRelationParams {
  sessionId: string
  schema?: string
  database?: string
  table?: string
  name?: string
  type?: string
}

export interface SqliteColumnInfo {
  name: string
  dataType?: string
  nullable?: boolean
  default?: string
  primaryKey?: boolean
  pkOrdinal?: number
  ordinal?: number
  /** 列级 CHECK 表达式（不含外层 CHECK()） */
  check?: string
  generatedExpr?: string
  /** VIRTUAL | STORED */
  generatedType?: string
}

export interface SqliteMetaColumnsResult {
  columns: SqliteColumnInfo[]
}

export interface SqliteIndexColumn {
  name: string
  ordinal: number
  descending?: boolean
}

export interface SqliteIndexInfo {
  name: string
  unique: boolean
  origin?: string
  partial?: boolean
  columns?: SqliteIndexColumn[]
}

export interface SqliteMetaIndexesResult {
  indexes: SqliteIndexInfo[]
}

export interface SqliteMetaDDLResult {
  ddl: string
  name?: string
  type?: string
  schema?: string
  /** 兼容前端 MysqlDdlPane 字段名 */
  objectType?: string
}

export interface SqliteMetaPrimaryKeyResult {
  columns: string[]
}

export interface SqliteForeignKeyInfo {
  id: number
  sequence: number
  referencedTable: string
  fromColumn: string
  toColumn: string
  onUpdate?: string
  onDelete?: string
}

export interface SqliteMetaForeignKeysResult {
  foreignKeys: SqliteForeignKeyInfo[]
}

export interface SqliteTxSessionParams {
  sessionId: string
}

export interface SqliteTxSetAutoCommitParams {
  sessionId: string
  autoCommit: boolean
}

export interface SqliteTxState {
  autoCommit: boolean
  inTransaction: boolean
}

export interface SqliteSessionAttachParams {
  sessionId: string
  attach?: SqliteAttachEntry[]
  /** 单条 ATTACH 简写（与 attach[] 二选一） */
  alias?: string
  filePath?: string
  readOnly?: boolean
}

export interface SqliteSessionAttachResult {
  attached: number
}

export interface SqliteSessionDetachParams {
  sessionId: string
  aliases?: string[]
  /** 单个别名简写（与 aliases[] 二选一） */
  alias?: string
}

export interface SqliteSessionDetachResult {
  detached: number
}

export interface SqliteAttachedDatabase {
  seq: number
  name: string
  file?: string
}

export interface SqliteMetaDatabaseInfoParams {
  sessionId?: string
  profileId?: string
}

export interface SqliteMetaDatabaseInfoResult {
  version?: string
  pageCount?: number
  pageSize?: number
  freelistCount?: number
  encoding?: string
  journalMode?: string
  synchronous?: string
  foreignKeys: boolean
  autoVacuum?: string
  databases?: SqliteAttachedDatabase[]
}

// ─── IO: import / export ────────────────────────────────────────────────────

export interface SqliteIoCsvOptions {
  header?: boolean
  delimiter?: string
  nullString?: string
  truncate?: boolean
  /** CSV 表头（或 col1…）→ 表列名；空映射跳过该源列 */
  columnMap?: Record<string, string>
}

export type SqliteIoDumpMode = 'structure_and_data' | 'structure_only' | 'data_only'

export interface SqliteIoExportCsvParams {
  sessionId?: string
  profileId?: string
  /** SQLite schema（ATTACH 别名，默认 main） */
  schema: string
  /** 兼容别名：当作 schema */
  database?: string
  table: string
  outputPath: string
  /** 勿用 options：platform 凭据注入会覆盖连接 options */
  csvOptions?: SqliteIoCsvOptions
}

export interface SqliteIoImportCsvParams {
  sessionId?: string
  profileId?: string
  schema: string
  database?: string
  table: string
  inputPath: string
  /** 勿用 options：platform 凭据注入会覆盖连接 options */
  csvOptions?: SqliteIoCsvOptions
}

export interface SqliteIoDumpSqlParams {
  sessionId?: string
  profileId?: string
  dump: {
    schema: string
    /** 兼容别名：当作 schema */
    database?: string
    tables?: string[]
    mode: SqliteIoDumpMode
    outputPath: string
    dropIfExists?: boolean
    truncateBeforeData?: boolean
    includeTables?: boolean
    includeViews?: boolean
    includeTriggers?: boolean
    includeIndexes?: boolean
  }
}

export interface SqliteIoExecSqlFileParams {
  sessionId?: string
  profileId?: string
  schema: string
  database?: string
  inputPath: string
  /** 勿用 options：platform 凭据注入会覆盖连接 options */
  execOptions?: { continueOnError?: boolean }
}

export interface SqliteIoTaskResult {
  taskId: string
}

export interface SqliteIoCancelParams {
  sessionId?: string
  taskId: string
}

export interface SqliteIoProgressEvent {
  type: string
  taskId: string
  phase: string
  message?: string
}

export interface SqliteIoDoneEvent {
  type: string
  taskId: string
  ok: boolean
  message?: string
  outputPath?: string
}

// ─── DDL: design / createTable ──────────────────────────────────────────────

export interface SqliteDesignColumnSpec {
  name: string
  dataType: string
  nullable?: boolean
  default?: string | null
  autoIncrement?: boolean
  primaryKey?: boolean
  check?: string
  generatedExpr?: string
  /** VIRTUAL | STORED */
  generatedType?: string
}

export interface SqliteDesignIndexSpec {
  name?: string
  columns: string[]
  unique?: boolean
  primary?: boolean
}

export interface SqliteDesignForeignKeySpec {
  name?: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

/** 扁平设计操作（对齐 sqlite-service/internal/ddl DesignOp） */
export type SqliteDesignOp = {
  op: string
  name?: string
  newName?: string
  dataType?: string
  default?: string | null
  nullable?: boolean
  columns?: string[]
  unique?: boolean
  refSchema?: string
  refDatabase?: string
  refTable?: string
  refColumns?: string[]
  onDelete?: string
  onUpdate?: string
  autoIncrement?: boolean
  check?: string
  generatedExpr?: string
  generatedType?: string
}

export interface SqliteDdlDesignPreviewParams {
  sessionId?: string
  /** SQLite schema（ATTACH 别名）；缺省可用 database 兼容 */
  schema?: string
  database?: string
  name: string
  ops: SqliteDesignOp[]
}

export interface SqliteDdlDesignPreviewResult {
  sql: string[]
  /** alter = 原生 ALTER；rebuild = 重建表拷贝数据 */
  strategy?: 'alter' | 'rebuild' | string
  warning?: string
}

export interface SqliteDdlDesignApplyParams {
  sessionId?: string
  schema?: string
  database?: string
  name: string
  ops: SqliteDesignOp[]
}

export interface SqliteDdlDesignApplyResult {
  sql: string[]
  strategy?: 'alter' | 'rebuild' | string
  warning?: string
  durationMs?: number
}

export interface SqliteDdlCreateTableParams {
  sessionId?: string
  schema?: string
  database?: string
  name: string
  columns: SqliteDesignColumnSpec[]
  indexes?: SqliteDesignIndexSpec[]
  foreignKeys?: SqliteDesignForeignKeySpec[]
  ifNotExists?: boolean
}

export interface SqliteDdlCreateTableResult {
  sql: string[]
  durationMs?: number
}

// ─── Backup ─────────────────────────────────────────────────────────────────

export interface SqliteBackupCopyParams {
  sessionId?: string
  profileId?: string
  outputPath: string
}

export interface SqliteBackupCopyResult {
  ok: boolean
  outputPath: string
}

export interface SqliteBackupProgressEvent {
  type: string
  session?: string
  pages?: number
  message?: string
}

export interface SqliteBackupDoneEvent {
  type: string
  session?: string
  ok: boolean
  outputPath?: string
  pages?: number
  message?: string
}
