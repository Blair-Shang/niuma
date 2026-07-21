/**
 * Vastbase 能力类型 —— `vastbase.*` Bridge 契约（对应 `services/vastbase-service`）。
 *
 * 连接站点 / 凭据 / 代理公共类型见 `./connection`。
 * 协议专属字段统一 **snake_case**（见 docs/22-vastbase-module.md §4）。
 */
import type { ConnectionOptionsBase } from './connection'

/** SSL 模式（libpq sslmode） */
export type VastSSLMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

/**
 * Vastbase 连接选项（存于 connection_options JSON）。
 *
 * platform 凭据注入信封固定为 `{ hostAddress, portNumber, loginAccount, secret, options }`，
 * 专属字段均放在 `options` 内，与 vastbase-service `ConnectOptions` 对齐。
 */
export interface VastConnectionOptions extends ConnectionOptionsBase {
  /** 初始登录库 */
  database: string
  ssl_mode: VastSSLMode
  /** CA 根证书路径（libpq sslrootcert） */
  ssl_root_cert?: string
  /** 客户端证书路径（libpq sslcert） */
  ssl_cert?: string
  /** 客户端私钥路径（libpq sslkey） */
  ssl_key?: string
  search_path: string
  /**
   * 客户端编码（libpq client_encoding）。
   * 空字符串表示不显式设置，使用服务器默认。
   */
  client_encoding?: string
  application_name: string
  /** 建连超时（秒） */
  connect_timeout_seconds: number
  /** 语句超时（毫秒）；0 表示不设置 */
  statement_timeout_ms: number
  /** 对象树是否隐藏系统 schema */
  exclude_system_schemas: boolean
  /**
   * 与 ConnectionTimeoutFields / 通用约定对齐的别名；服务端亦读取。
   * @deprecated 优先 `connect_timeout_seconds`
   */
  timeout_seconds?: number
}

/** 默认 Vastbase 连接选项 */
export const DEFAULT_VAST_OPTIONS: VastConnectionOptions = {
  database: 'postgres',
  ssl_mode: 'prefer',
  ssl_root_cert: '',
  ssl_cert: '',
  ssl_key: '',
  search_path: '',
  client_encoding: 'UTF8',
  application_name: 'niuma-vastbase',
  connect_timeout_seconds: 10,
  statement_timeout_ms: 0,
  exclude_system_schemas: true,
  proxy: { type: 'none' },
}

/** `vastbase.session.open` 入参 */
export interface VastSessionOpenParams {
  profileId: string
}

/** `vastbase.session.open` 返回 */
export interface VastSessionOpenResult {
  sessionId: string
  /** 连接探测的方言能力集（DBeaver/Navicat 产品类型行为） */
  dialect?: VastDialectProfile
}

/** 会话方言档案（与 Go dialect.ServerProfile 对齐） */
export interface VastDialectProfile {
  family: string
  version?: string
  versionNum?: string
  sqlCompatibility?: string
  capabilities: string[]
}

/** `vastbase.session.close` 入参 */
export interface VastSessionCloseParams {
  sessionId: string
}

/** `vastbase.session.test` 入参（凭据可由平台注入或测试对话框直传） */
export interface VastSessionTestParams {
  hostAddress: string
  portNumber: number
  loginAccount?: string
  secret?: string
  password?: string
  options?: Partial<VastConnectionOptions>
}

/** `vastbase.session.test` 返回 */
export interface VastSessionTestResult {
  ok: boolean
  message: string
  version?: string
  dialect?: VastDialectProfile
}

/** 树列表通用过滤 */
export interface VastTreeListParams {
  profileId?: string
  sessionId?: string
  database?: string
  schema?: string
  filter?: string
  limit?: number
  excludeSystem?: boolean
  /** tree.tables 类型过滤：table / view / materialized_view / foreign_table */
  types?: string[]
  /** tree.routines 类型过滤：function / procedure */
  kinds?: string[]
}

export interface VastDatabaseInfo {
  name: string
}

export interface VastSchemaInfo {
  name: string
}

export interface VastTableInfo {
  name: string
  type: string
}

export interface VastRoutineInfo {
  oid?: number
  name: string
  kind: string
  args?: string
}

export interface VastTreeDatabasesResult {
  databases: VastDatabaseInfo[]
  truncated?: boolean
}

export interface VastTreeSchemasResult {
  schemas: VastSchemaInfo[]
  truncated?: boolean
}

export interface VastTreeTablesResult {
  tables: VastTableInfo[]
  truncated?: boolean
}

export interface VastTreeRoutinesResult {
  routines: VastRoutineInfo[]
  truncated?: boolean
}

/** schema 下分类对象数量（非行数） */
export interface VastTreeCategoryCountsResult {
  tables: number
  views: number
  functions: number
  procedures: number
  sequences?: number
}

export interface VastSequenceInfo {
  name: string
}

export interface VastTreeSequencesResult {
  sequences: VastSequenceInfo[]
  truncated?: boolean
}

/** `vastbase.meta.schemaOverview`：Schema 属性与对象数量概览 */
export interface VastMetaSchemaOverviewResult {
  name: string
  owner?: string
  comment?: string
  tables: number
  views: number
  functions: number
  procedures: number
}

/** `vastbase.meta.databaseOverview`：库属性与粗粒度对象统计 */
export interface VastMetaDatabaseOverviewResult {
  name: string
  owner?: string
  encoding?: string
  collate?: string
  ctype?: string
  comment?: string
  sizeBytes?: number
  schemas: number
  tables: number
  views: number
  functions: number
  procedures: number
}

/** `vastbase.meta.instanceOverview`：实例属性 */
export interface VastMetaInstanceOverviewResult {
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

export interface VastActivitySession {
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

export interface VastMetaActivityResult {
  sessions: VastActivitySession[]
  truncated?: boolean
  limit?: number
}

export interface VastLockInfo {
  pid: number
  mode?: string
  granted: boolean
  relation?: string
  lockType?: string
  database?: string
  blockedByPid?: number
}

export interface VastLockBlockingEdge {
  blockedPid: number
  blockingPid: number
}

export interface VastMetaLocksResult {
  locks: VastLockInfo[]
  blocking?: VastLockBlockingEdge[]
  truncated?: boolean
  limit?: number
}

export interface VastMetaBackendActionResult {
  pid: number
  success: boolean
}

/** `vastbase.catalog.*`：SQL 补全目录检索（docs/23） */
export interface VastCatalogListParams {
  sessionId: string
  database?: string
  schema?: string
  /** columns：表名；与 name 二选一 */
  table?: string
  name?: string
  prefix?: string
  limit?: number
  excludeSystem?: boolean
  types?: string[]
}

export interface VastCatalogSchemasResult {
  schemas: VastSchemaInfo[]
  truncated?: boolean
}

export interface VastCatalogTablesResult {
  tables: VastTableInfo[]
  truncated?: boolean
}

export interface VastCatalogColumnsResult {
  columns: VastColumnInfo[]
  truncated?: boolean
}

/** `vastbase.query.exec` 入参 */
export interface VastQueryExecParams {
  sessionId: string
  /** 可选：与会话默认库不同时在目标库执行 */
  database?: string
  sql: string
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface VastQueryColumn {
  name: string
  /** 含精度，如 character varying(64)、numeric(10,2) */
  dataType?: string
  /** 来自真实表列时有值；表达式列为 undefined */
  nullable?: boolean
  /** 是否主键列 */
  primaryKey?: boolean
}

/** `vastbase.query.exec` 返回 */
export interface VastQueryExecResult {
  requestId: string
  /** 服务端游标 ID；hasMore 时存在，供 query.fetch 续取 */
  resultSetId?: string
  columns: VastQueryColumn[]
  rows: unknown[][]
  /** 本页行数 */
  rowCount: number
  /** 累计已取行数 */
  fetchedCount?: number
  /** 服务端仍有未取完的行（对标 DBeaver Load more） */
  hasMore?: boolean
  /** 触达服务端累计行数软上限，无法再续取 */
  truncated?: boolean
  durationMs: number
  commandTag?: string
  notices?: string[]
}

/** `vastbase.query.fetch` 入参 */
export interface VastQueryFetchParams {
  sessionId: string
  resultSetId: string
  limit?: number
}

/** `vastbase.query.fetch` 返回 */
export interface VastQueryFetchResult {
  resultSetId?: string
  rows: unknown[][]
  rowCount: number
  fetchedCount: number
  hasMore: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
}

/** `vastbase.query.close` 入参 */
export interface VastQueryCloseParams {
  sessionId: string
  resultSetId?: string
}

/** `vastbase.query.cancel` 入参 */
export interface VastQueryCancelParams {
  sessionId: string
  requestId?: string
}

/** 元数据关系 / 例程定位 */
export interface VastMetaRelationParams {
  sessionId?: string
  profileId?: string
  database?: string
  /** Schema；库概览等场景可省略 */
  schema?: string
  /** 表 / 视图 / 例程名；也可传 table */
  name?: string
  table?: string
  /** 例程 identity arguments（无外层括号） */
  args?: string
  oid?: number
  /** function / procedure：依赖分析走 pg_proc */
  kind?: string
}

export interface VastColumnInfo {
  ordinal: number
  name: string
  dataType: string
  nullable: boolean
  default?: string | null
  comment?: string
}

export interface VastIndexInfo {
  name: string
  unique: boolean
  primary: boolean
  definition: string
  columns?: string[]
  keyExpression?: string
  where?: string
  /** btree/hash/gin/gist/brin/spgist */
  method?: string
}

export interface VastConstraintInfo {
  name: string
  type: string
  typeLabel: string
  definition: string
  /** CHECK 约束体（不含 CHECK 关键字） */
  expression?: string
}

export interface VastMetaColumnsResult {
  columns: VastColumnInfo[]
  tableComment?: string
}

export interface VastMetaIndexesResult {
  indexes: VastIndexInfo[]
}

export interface VastMetaConstraintsResult {
  constraints: VastConstraintInfo[]
}

export interface VastMetaDDLResult {
  objectType: string
  ddl: string
}

export interface VastMetaRoutineSourceResult {
  name: string
  kind: string
  args?: string
  definition: string
  oid?: number
}

export interface VastDependencyInfo {
  direction: 'depends_on' | 'referenced_by' | string
  schema: string
  name: string
  kind: string
  detail?: string
}

export interface VastMetaDependenciesResult {
  dependencies: VastDependencyInfo[]
}

export interface VastMetaPrimaryKeyResult {
  columns: string[]
}

export interface VastForeignKeyInfo {
  name: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export interface VastMetaForeignKeysResult {
  foreignKeys: VastForeignKeyInfo[]
}

export interface VastDebugCapabilities {
  available: boolean
  reason?: string
  schema?: string
  version?: string
  hasDebuggerRole?: boolean
  addBreakpointFuncoidKind?: string
}

export interface VastDebugPosition {
  funcoid: number
  funcname?: string
  line: number
  query?: string
}

export interface VastDebugStartParams {
  sessionId: string
  database?: string
  schema?: string
  name?: string
  args?: string
  oid?: number
  callArgs?: string
  routineKind?: 'function' | 'procedure'
}

export interface VastDebugStartResult {
  debugId: string
  state: string
  oid: number
  position: VastDebugPosition
}

/** 已附加调试会话上的后续操作（透传 sessionId 以免误走凭据注入） */
export interface VastDebugSessionParams {
  debugId: string
  sessionId?: string
}

export interface VastDebugControlResult {
  state: string
  position: VastDebugPosition
  /** DBMS_OUTPUT / DBE_OUTPUT 缓冲（例程结束后返回） */
  output?: string[]
}

export interface VastDebugStopResult {
  stopped: boolean
  output?: string[]
}

export interface VastDebugCodeLine {
  /** 编辑器行号（1-based，按 info_code 返回顺序） */
  line: number
  /** 厂商 info_code.lineno，断点 / 当前位置用；函数头可能为 0 */
  debugLine?: number
  code: string
  canBreak: boolean
}

export interface VastDebugVariable {
  name: string
  type: string
  value: string
  packageName?: string
}

/** print_var：读取指定变量（观察表达式） */
export interface VastDebugEvaluateParams extends VastDebugSessionParams {
  name: string
  /** 省略则默认顶层栈 */
  frameNo?: number
}

export interface VastDebugStackFrame {
  frameNo: number
  funcoid: number
  funcname: string
  line: number
  query?: string
}

export interface VastDebugBreakpoint {
  number: number
  funcoid: number
  line: number
  enable: boolean
  query?: string
}

export interface VastDesignOp {
  op:
    | 'add_column'
    | 'drop_column'
    | 'rename_column'
    | 'alter_type'
    | 'set_null'
    | 'set_not_null'
    | 'set_default'
    | 'drop_default'
    | 'set_column_comment'
    | 'add_primary_key'
    | 'drop_primary_key'
    | 'add_unique'
    | 'add_index'
    | 'drop_index'
    | 'rename_index'
    | 'drop_constraint'
    | 'add_foreign_key'
    | 'add_check'
    | 'set_table_comment'
  name: string
  newName?: string
  dataType?: string
  default?: string | null
  /** add_column：false 时内联 NOT NULL */
  nullable?: boolean
  comment?: string
  columns?: string[]
  unique?: boolean
  expression?: string
  where?: string
  /** 索引访问方法：btree/hash/gin/gist/brin/spgist */
  method?: string
  refSchema?: string
  refTable?: string
  refColumns?: string[]
  onDelete?: string
  onUpdate?: string
}

export interface VastDesignParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema: string
  name: string
  ops: VastDesignOp[]
}

export interface VastDesignPreviewResult {
  sql: string[]
}

export interface VastDesignApplyResult {
  sql: string[]
  commandTags?: string[]
  durationMs: number
}

/** 可视化新建表列定义 */
export interface VastCreateTableColumn {
  name: string
  dataType: string
  nullable: boolean
  default?: string | null
  primaryKey?: boolean
  comment?: string
}

export interface VastCreateTableIndex {
  name: string
  columns?: string[]
  expression?: string
  where?: string
  unique?: boolean
  method?: string
}

export interface VastCreateTableForeignKey {
  name?: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
  onDelete?: string
  onUpdate?: string
}

export interface VastCreateTableCheck {
  name?: string
  expression: string
}

export interface VastCreateTableParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema: string
  name: string
  columns: VastCreateTableColumn[]
  comment?: string
  indexes?: VastCreateTableIndex[]
  foreignKeys?: VastCreateTableForeignKey[]
  checks?: VastCreateTableCheck[]
}

export interface VastCreateTableResult {
  sql: string[]
  commandTags?: string[]
  durationMs?: number
}

export interface VastDatabaseCreateOptionsResult {
  owners: string[]
  encodings: string[]
  templates: string[]
  collations: string[]
  defaultEncoding?: string
  defaultTemplate?: string
  defaultLcCollate?: string
  defaultLcCtype?: string
}

export interface VastDatabaseCreateOptionsParams {
  sessionId?: string
  profileId?: string
  encoding?: string
}

/** DDL 白名单动作 */
export type VastDdlAction =
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

export interface VastDdlParams {
  sessionId?: string
  profileId?: string
  database?: string
  schema?: string
  name?: string
  args?: string
  oid?: number
  newName?: string
  owner?: string
  encoding?: string
  template?: string
  lcCollate?: string
  lcCtype?: string
  /** 可选；有 sessionId 时服务端优先用会话探测结果 */
  capabilities?: string[]
  action: VastDdlAction
}

export interface VastDdlScriptResult {
  action: string
  sql: string
  danger?: boolean
  summary?: string
}

export interface VastDdlExecResult {
  action: string
  commandTag?: string
  durationMs: number
}

/** CSV 导入/导出选项。 */
export interface VastIoCsvOptions {
  header?: boolean
  delimiter?: string
  nullString?: string
  truncate?: boolean
  encoding?: string
}

export type VastIoDumpMode = 'structure_and_data' | 'structure_only' | 'data_only'

/** 堆转储选项（对齐 Navicat / DBeaver 常用项）。 */
export interface VastIoDumpOptions {
  includeTables?: boolean
  includeViews?: boolean
  includeMatViews?: boolean
  dropIfExists?: boolean
  truncateBeforeData?: boolean
  createSchema?: boolean
  excludeSystem?: boolean
}

/** 执行 SQL 文件选项。 */
export interface VastIoExecOptions {
  /** 单条失败后继续执行后续语句 */
  continueOnError?: boolean
}

export interface VastIoTaskResult {
  taskId: string
}

export interface VastIoProgressEvent {
  type: 'vastbase.io.progress'
  taskId: string
  phase: string
  bytes?: number
  rows?: number
  message?: string
}

export interface VastIoDoneEvent {
  type: 'vastbase.io.done'
  taskId: string
  ok: boolean
  message?: string
  outputPath?: string
}

export interface VastToolsDetectResult {
  vb_dump: VastToolDetectEntry
  vb_restore: VastToolDetectEntry
  vsql: VastToolDetectEntry
}

export interface VastToolDetectEntry {
  available: boolean
  path?: string
  version?: string
}

/** vb_dump -F 输出格式 */
export type VastToolsDumpFormat = 'c' | 'd' | 't' | 'p'

/** 结构 / 数据范围 */
export type VastToolsContentMode = 'all' | 'schema_only' | 'data_only'

export interface VastToolsDumpOptions {
  format?: VastToolsDumpFormat
  mode?: VastToolsContentMode
  schemas?: string[]
  excludeSchemas?: string[]
  tables?: string[]
  excludeTables?: string[]
  jobs?: number
  compress?: number
  clean?: boolean
  create?: boolean
  noOwner?: boolean
  noPrivileges?: boolean
  blobs?: boolean
  encoding?: string
  verbose?: boolean
}

export interface VastToolsRestoreOptions {
  format?: VastToolsDumpFormat
  mode?: VastToolsContentMode
  schemas?: string[]
  tables?: string[]
  jobs?: number
  clean?: boolean
  ifExists?: boolean
  create?: boolean
  noOwner?: boolean
  noPrivileges?: boolean
  disableTriggers?: boolean
  singleTransaction?: boolean
  verbose?: boolean
}

export interface VastToolsProgressEvent {
  type: 'vastbase.tools.progress'
  taskId: string
  phase: string
  message?: string
}

export interface VastToolsDoneEvent {
  type: 'vastbase.tools.done'
  taskId: string
  ok: boolean
  message?: string
  outputPath?: string
}
