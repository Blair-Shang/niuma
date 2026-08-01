/**
 * MySQL 能力类型 —— `mysql.*` Bridge 契约（对应 `services/mysql-service`）。
 *
 * 连接站点 / 凭据 / 代理公共类型见 `./connection`。
 * 协议专属字段统一 **snake_case**（见 docs/25-mysql-module.md）。
 */
import type { ConnectionOptionsBase } from './connection'

/** TLS / SSL 模式（与服务端 ConnectOptions 对齐） */
export type MysqlSSLMode =
  | 'disable'
  | 'preferred'
  | 'require'
  | 'verify-ca'
  | 'verify-identity'

/**
 * MySQL 连接选项（存于 connection_options JSON）。
 *
 * platform 凭据注入信封为 `{ hostAddress, portNumber, loginAccount, secret, options }`。
 */
export interface MysqlConnectionOptions extends ConnectionOptionsBase {
  /** 初始登录库；可空 */
  database: string
  /**
   * 客户端连接字符集（对齐 Navicat Client Character Set / DBeaver characterEncoding）。
   * 建连时 `SET NAMES <charset>`；默认 `utf8mb4`。
   */
  charset: string
  /**
   * 连接排序规则（对齐 DBeaver connectionCollation）。
   * 空字符串表示仅设字符集，使用该字符集在服务器上的默认 collation。
   */
  collation?: string
  ssl_mode: MysqlSSLMode
  /** CA 证书文件路径（PEM），可选 */
  ssl_ca?: string
  /** 客户端证书路径（PEM），可选 */
  ssl_cert?: string
  /** 客户端私钥路径（PEM），可选 */
  ssl_key?: string
  allowNativePasswords: boolean
  application_name: string
  connect_timeout_seconds: number
  /** 对象树是否隐藏系统库（P1） */
  exclude_system_schemas: boolean
  /** @deprecated 优先 `connect_timeout_seconds` */
  timeout_seconds?: number
}

/** 默认 MySQL 连接选项 */
export const DEFAULT_MYSQL_OPTIONS: MysqlConnectionOptions = {
  database: '',
  charset: 'utf8mb4',
  collation: '',
  ssl_mode: 'preferred',
  ssl_ca: '',
  ssl_cert: '',
  ssl_key: '',
  allowNativePasswords: true,
  application_name: 'niuma-mysql',
  connect_timeout_seconds: 10,
  exclude_system_schemas: true,
  proxy: { type: 'none' },
}

/** 会话方言档案（与 Go dialect.ServerProfile 对齐） */
export interface MysqlDialectProfile {
  family: string
  version?: string
  versionNum?: string
  sqlCompatibility?: string
  capabilities: string[]
}

export interface MysqlSessionOpenParams {
  profileId: string
  /** 覆盖连接配置默认库，按查询 Tab 目标库建连 */
  database?: string
}

export interface MysqlSessionOpenResult {
  sessionId: string
  dialect?: MysqlDialectProfile
}

export interface MysqlSessionCloseParams {
  sessionId: string
}

export interface MysqlSessionTestParams {
  hostAddress: string
  portNumber: number
  loginAccount?: string
  secret?: string
  password?: string
  options?: Partial<MysqlConnectionOptions>
}

export interface MysqlSessionTestResult {
  ok: boolean
  message: string
  version?: string
  dialect?: MysqlDialectProfile
}

export interface MysqlQueryExecParams {
  sessionId: string
  database?: string
  sql: string
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface MysqlQueryColumn {
  name: string
  dataType?: string
  nullable?: boolean
  primaryKey?: boolean
  /** 显示宽度 / 字符长度（如 TINYINT(1)、VARCHAR(n)、BIT(n)） */
  length?: number
  precision?: number
  scale?: number
}

export interface MysqlQueryExecResult {
  requestId: string
  resultSetId?: string
  columns: MysqlQueryColumn[]
  rows: unknown[][]
  rowCount: number
  fetchedCount?: number
  hasMore?: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
  rowsAffected?: number
}

export interface MysqlQueryFetchParams {
  sessionId: string
  resultSetId: string
  limit?: number
}

export interface MysqlQueryFetchResult {
  resultSetId?: string
  rows: unknown[][]
  rowCount: number
  fetchedCount: number
  hasMore: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
}

export interface MysqlQueryCloseParams {
  sessionId: string
  resultSetId?: string
}

export interface MysqlQueryCancelParams {
  sessionId: string
  requestId?: string
}

/** 会话事务 / Auto-commit 状态 */
export interface MysqlTxState {
  autoCommit: boolean
  inTransaction: boolean
}

export interface MysqlTxSessionParams {
  sessionId: string
}

export interface MysqlTxSetAutoCommitParams {
  sessionId: string
  autoCommit: boolean
}


export interface MysqlTreeListParams {
  profileId?: string
  sessionId?: string
  database?: string
  filter?: string
  limit?: number
  excludeSystem?: boolean
  /** table / view */
  types?: string[]
}

export interface MysqlDatabaseInfo {
  name: string
}

export interface MysqlTableInfo {
  name: string
  type: string
}

export interface MysqlTreeDatabasesResult {
  databases: MysqlDatabaseInfo[]
  truncated?: boolean
}

export interface MysqlTreeTablesResult {
  tables: MysqlTableInfo[]
  truncated?: boolean
}

export interface MysqlRoutineInfo {
  name: string
  type: string
}

export interface MysqlTreeRoutinesResult {
  routines: MysqlRoutineInfo[]
  truncated?: boolean
}

/** database 下分类对象数量（非行数） */
export interface MysqlTreeCategoryCountsResult {
  tables: number
  views: number
  functions: number
  procedures: number
}

/** 元数据关系定位（表 / 视图） */
export interface MysqlMetaRelationParams {
  sessionId?: string
  profileId?: string
  database: string
  /** 表 / 视图名；也可传 table */
  name?: string
  table?: string
}

export interface MysqlColumnInfo {
  ordinal: number
  name: string
  dataType: string
  nullable: boolean
  default?: string | null
  comment?: string
  /** 是否 AUTO_INCREMENT（information_schema.COLUMNS.EXTRA） */
  autoIncrement?: boolean
}

export interface MysqlIndexInfo {
  name: string
  unique: boolean
  primary: boolean
  definition: string
  columns?: string[]
  method?: string
}

export interface MysqlMetaColumnsResult {
  columns: MysqlColumnInfo[]
  tableComment?: string
}

export interface MysqlMetaIndexesResult {
  indexes: MysqlIndexInfo[]
}

export interface MysqlMetaDDLResult {
  objectType: string
  ddl: string
}

export interface MysqlMetaRoutineParams {
  sessionId?: string
  profileId?: string
  database: string
  name?: string
  routine?: string
  /** procedure | function */
  kind: 'procedure' | 'function'
}

export interface MysqlMetaRoutineSourceResult {
  name: string
  kind: string
  definition: string
}

export interface MysqlRoutineParameter {
  ordinal: number
  name: string
  /** IN | OUT | INOUT；返回值伪行无 mode */
  mode: string
  dataType: string
  dtdIdentifier: string
  isReturn: boolean
}

export interface MysqlMetaRoutineParametersResult {
  name: string
  kind: string
  parameters: MysqlRoutineParameter[]
  returnType?: string
}

/** 进程列表（SHOW FULL PROCESSLIST） */
export interface MysqlProcessInfo {
  id: number
  user: string
  host: string
  db?: string | null
  command: string
  time: number
  state?: string | null
  info?: string | null
}

export interface MysqlMetaProcesslistParams {
  sessionId: string
}

export interface MysqlMetaProcesslistResult {
  processes: MysqlProcessInfo[]
}

export interface MysqlMetaKillParams {
  sessionId: string
  id: number
  /** true → KILL QUERY；false → KILL CONNECTION */
  queryOnly?: boolean
}

export interface MysqlMetaKillResult {
  killed: boolean
  id: number
  queryOnly: boolean
}

/** SQL 补全目录（docs/23；MySQL schema 槽位 = database） */
export interface MysqlCatalogListParams {
  sessionId: string
  database?: string
  /** MySQL：等于 database 名 */
  schema?: string
  table?: string
  name?: string
  prefix?: string
  limit?: number
  excludeSystem?: boolean
  types?: string[]
}

export interface MysqlCatalogSchemasResult {
  schemas: Array<{ name: string }>
  truncated?: boolean
}

export interface MysqlCatalogTablesResult {
  tables: Array<{ name: string; type?: string }>
  truncated?: boolean
}

export interface MysqlCatalogColumnsResult {
  columns: MysqlColumnInfo[]
  truncated?: boolean
}

/** SQL Language Server（Bridge 隧道 LSP） */
export interface MysqlLspOpenParams {
  sessionId: string
  clientId: string
  /** 编辑器当前库（补全默认 schema）；可空 */
  database?: string
}

export interface MysqlLspOpenResult {
  connectionId: string
}

export interface MysqlLspRpcParams {
  connectionId: string
  sessionId: string
  /** JSON-RPC 2.0 消息对象 */
  message: Record<string, unknown>
}

export interface MysqlLspRpcResult {
  ok?: boolean
  message?: Record<string, unknown>
}

export interface MysqlLspCloseParams {
  connectionId: string
  sessionId?: string
}

/** Monarch 高亮词表（关键字 + 内置函数）；无需 session */
export interface MysqlLspLexiconParams {
  /** 预留；MySQL 忽略 */
  sessionId?: string
  compat?: string
}

export interface MysqlLspLexiconResult {
  keywords: string[]
  functions: string[]
  compat?: string
}

export interface MysqlQueryExplainParams {
  sessionId: string
  database?: string
  sql: string
  analyze?: boolean
  limit?: number
  timeoutMs?: number
  requestId?: string
}

// ─── Monitor: instance overview ────────────────────────────────────────────

export interface MysqlMetaInstanceOverviewParams {
  sessionId: string
}

export interface MysqlMetaInstanceOverviewResult {
  version: string
  versionComment?: string
  currentUser?: string
  currentDatabase?: string
  serverAddr?: string
  uptimeSeconds?: number
  databaseCount?: number
  threadsConnected?: number
  maxConnections?: number
  questions?: number
  slowQueries?: number
  /** 部分 GLOBAL STATUS 读取失败 */
  statusPartial?: boolean
  warnings?: string[]
}

// ─── Monitor: lock info ─────────────────────────────────────────────────────

export interface MysqlLockInfo {
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

export interface MysqlMetaLocksParams {
  sessionId: string
  limit?: number
}

export interface MysqlMetaLocksResult {
  locks: MysqlLockInfo[]
  truncated?: boolean
  limit?: number
  /** 无权限 / performance_schema 未开等：非硬失败 */
  unavailable?: boolean
  message?: string
}

// ─── Monitor: variables / status / deadlock ─────────────────────────────────

export interface MysqlServerKVItem {
  name: string
  value: string
}

export interface MysqlMetaServerKVParams {
  sessionId: string
  /** 可选 SHOW ... LIKE 模式；空则全量（服务端有上限） */
  like?: string
}

export interface MysqlMetaServerKVResult {
  items: MysqlServerKVItem[]
  truncated?: boolean
  limit?: number
}

export interface MysqlMetaInnoDBDeadlockParams {
  sessionId: string
}

export interface MysqlMetaInnoDBDeadlockResult {
  hasDeadlock: boolean
  excerpt?: string
  rawLength?: number
}

// ─── Meta: primary key & foreign keys ──────────────────────────────────────

export interface MysqlMetaPrimaryKeyParams {
  sessionId?: string
  profileId?: string
  database: string
  name?: string
  table?: string
}

export interface MysqlMetaPrimaryKeyResult {
  columns: string[]
}

export interface MysqlForeignKeyInfo {
  name: string
  columns: string[]
  refDatabase?: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export interface MysqlMetaForeignKeysParams {
  sessionId?: string
  profileId?: string
  database: string
  name?: string
  table?: string
}

export interface MysqlMetaForeignKeysResult {
  foreignKeys: MysqlForeignKeyInfo[]
}

// ─── DDL: table design ──────────────────────────────────────────────────────

export interface MysqlDesignColumnSpec {
  name: string
  dataType: string
  nullable?: boolean
  default?: string | null
  comment?: string
  autoIncrement?: boolean
  primaryKey?: boolean
}

export interface MysqlDesignIndexSpec {
  name?: string
  columns: string[]
  unique?: boolean
  primary?: boolean
  method?: string
}

export interface MysqlDesignForeignKeySpec {
  name?: string
  columns: string[]
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export type MysqlDesignOp = {
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
  refDatabase?: string
  refTable?: string
  refColumns?: string[]
  onDelete?: string
  onUpdate?: string
}

export interface MysqlDdlDesignPreviewParams {
  sessionId?: string
  database: string
  name: string
  ops: MysqlDesignOp[]
}

export interface MysqlDdlDesignPreviewResult {
  sql: string[]
}

export interface MysqlDdlDesignApplyParams {
  sessionId?: string
  database: string
  name: string
  ops: MysqlDesignOp[]
}

export interface MysqlDdlDesignApplyResult {
  sql: string[]
  durationMs?: number
}

export interface MysqlDdlCreateTableParams {
  sessionId?: string
  database: string
  name: string
  columns: MysqlDesignColumnSpec[]
  indexes?: MysqlDesignIndexSpec[]
  foreignKeys?: MysqlDesignForeignKeySpec[]
  comment?: string
  engine?: string
  charset?: string
  collation?: string
}

export interface MysqlDdlCreateTableResult {
  sql: string[]
  durationMs?: number
}

// ─── IO: import / export ────────────────────────────────────────────────────

export interface MysqlIoCsvOptions {
  header?: boolean
  delimiter?: string
  nullString?: string
  truncate?: boolean
  /** CSV 表头（或 col1…）→ 表列名；空映射跳过该源列 */
  columnMap?: Record<string, string>
}

export type MysqlIoDumpMode = 'structure_and_data' | 'structure_only' | 'data_only'

export interface MysqlIoExportCsvParams {
  sessionId?: string
  profileId?: string
  database: string
  table: string
  outputPath: string
  /** 勿用 options：platform 凭据注入会覆盖连接 options */
  csvOptions?: MysqlIoCsvOptions
}

export interface MysqlIoImportCsvParams {
  sessionId?: string
  profileId?: string
  database: string
  table: string
  inputPath: string
  /** 勿用 options：platform 凭据注入会覆盖连接 options */
  csvOptions?: MysqlIoCsvOptions
}

export interface MysqlIoDumpSqlParams {
  sessionId?: string
  profileId?: string
  dump: {
    database: string
    tables?: string[]
    mode: MysqlIoDumpMode
    outputPath: string
    dropIfExists?: boolean
    truncateBeforeData?: boolean
    includeCreateDatabase?: boolean
    includeTables?: boolean
    includeViews?: boolean
    includeProcedures?: boolean
    includeFunctions?: boolean
    includeTriggers?: boolean
    includeEvents?: boolean
  }
}

export interface MysqlIoExecSqlFileParams {
  sessionId?: string
  profileId?: string
  database: string
  inputPath: string
  /** 勿用 options：platform 凭据注入会覆盖连接 options */
  execOptions?: { continueOnError?: boolean }
}

export interface MysqlIoTaskResult {
  taskId: string
}

export interface MysqlIoCancelParams {
  sessionId?: string
  taskId: string
}

export interface MysqlIoProgressEvent {
  type: string
  taskId: string
  phase: string
  message?: string
}

export interface MysqlIoDoneEvent {
  type: string
  taskId: string
  ok: boolean
  message?: string
  outputPath?: string
}

// ─── tools: mysqldump / mysql CLI ───────────────────────────────────────────

export interface MysqlToolDetectEntry {
  available: boolean
  path?: string
  version?: string
}

export interface MysqlToolsDetectResult {
  mysqldump: MysqlToolDetectEntry
  mysql: MysqlToolDetectEntry
}

export interface MysqlToolsDumpOptions {
  structureOnly?: boolean
  dataOnly?: boolean
  dropIfExists?: boolean
  routines?: boolean
  triggers?: boolean
  events?: boolean
  singleTransaction?: boolean
  /** OFF | ON | AUTO；默认 OFF，避免逻辑备份写入 GTID */
  setGtidPurged?: 'OFF' | 'ON' | 'AUTO'
  tables?: string[]
  /** 输出过程日志（--verbose，默认 true） */
  verbose?: boolean
}

export interface MysqlToolsRestoreOptions {
  /** 遇 SQL 错误继续（如表已存在） */
  force?: boolean
  /** 过滤备份中的 GTID_PURGED / SQL_LOG_BIN（默认 true） */
  stripGtid?: boolean
  /** 输出过程日志（--verbose，默认 true） */
  verbose?: boolean
}

export interface MysqlToolsDumpParams {
  sessionId?: string
  profileId?: string
  database: string
  outputPath?: string
  /** 勿用 options：platform 凭据注入会覆盖连接 options */
  dumpOptions?: MysqlToolsDumpOptions
  toolPaths?: Record<string, string>
}

export interface MysqlToolsRestoreParams {
  sessionId?: string
  profileId?: string
  database: string
  inputPath: string
  /** 勿用 options：platform 凭据注入会覆盖连接 options */
  restoreOptions?: MysqlToolsRestoreOptions
  toolPaths?: Record<string, string>
}

export interface MysqlToolsTaskResult {
  taskId: string
}

export interface MysqlToolsCancelParams {
  taskId: string
  sessionId?: string
}

export interface MysqlToolsDetectParams {
  toolPaths?: Record<string, string>
}
