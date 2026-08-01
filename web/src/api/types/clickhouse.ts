import type { ConnectionOptionsBase } from './connection'

export type ClickHouseProtocol = 'native' | 'http'

export interface ClickHouseConnectionOptions extends ConnectionOptionsBase {
  database?: string
  protocol?: ClickHouseProtocol
  secure?: boolean
  tls?: boolean
  ssl_mode?: string
  ssl_ca?: string
  ssl_cert?: string
  ssl_key?: string
  compress?: boolean
  application_name?: string
  connect_timeout_seconds?: number
  read_timeout_seconds?: number
  exclude_system_databases?: boolean
  /** DDL 默认 ON CLUSTER 名（非多主机连接串）。 */
  cluster?: string
  /**
   * 备用节点，逗号/分号/空白分隔；每项 host 或 host:port。
   * 与主地址一起按序 failover；SSH 隧道开启时忽略。
   */
  alt_hosts?: string
}

export const DEFAULT_CLICKHOUSE_OPTIONS: ClickHouseConnectionOptions = {
  database: 'default',
  protocol: 'native',
  secure: false,
  ssl_mode: 'disable',
  compress: true,
  application_name: 'NiuMa',
  connect_timeout_seconds: 10,
  exclude_system_databases: true,
  cluster: '',
  alt_hosts: '',
  proxy: { type: 'none' },
}

export interface ClickHouseDialectProfile {
  family: 'clickhouse'
  version?: string
  versionNum?: string
  sqlCompatibility?: string
  capabilities: string[]
}

export interface ClickHouseSessionOpenParams { profileId: string }
export interface ClickHouseSessionOpenResult { sessionId: string; dialect?: ClickHouseDialectProfile }
export interface ClickHouseSessionCloseParams { sessionId: string }
export interface ClickHouseSessionTestParams {
  hostAddress?: string
  portNumber?: number
  loginAccount?: string
  profileId?: string
  options?: Partial<ClickHouseConnectionOptions>
}
export interface ClickHouseSessionTestResult {
  ok: boolean
  message: string
  version?: string
  dialect?: ClickHouseDialectProfile
}

export interface ClickHouseQueryColumn {
  name: string
  dataType?: string
  nullable?: boolean
  length?: number
  precision?: number
  scale?: number
}

export interface ClickHouseQueryExecParams {
  sessionId: string
  database?: string
  sql: string
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface ClickHouseQueryExecResult {
  requestId: string
  resultSetId?: string
  columns?: ClickHouseQueryColumn[]
  rows?: unknown[][]
  rowCount: number
  fetchedCount?: number
  hasMore?: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
  rowsAffected?: number
}

export interface ClickHouseQueryFetchParams { sessionId: string; resultSetId: string; limit?: number }
export interface ClickHouseQueryFetchResult {
  resultSetId?: string
  rows: unknown[][]
  rowCount: number
  fetchedCount: number
  hasMore: boolean
  truncated?: boolean
  durationMs: number
  commandTag?: string
}
export interface ClickHouseQueryCloseParams { sessionId: string; resultSetId?: string }
export interface ClickHouseQueryCancelParams { sessionId: string; requestId?: string }

export interface ClickHouseQueryExplainParams {
  sessionId: string
  database?: string
  sql: string
  /** plan | estimate | pipeline | ast | syntax | queryTree | analyze */
  mode?: string
  analyze?: boolean
  indexes?: boolean
  header?: boolean
  description?: boolean
  actions?: boolean
  json?: boolean
  graph?: boolean
  limit?: number
  timeoutMs?: number
  requestId?: string
}

export interface ClickHouseTreeListParams {
  profileId?: string
  sessionId?: string
  database?: string
  filter?: string
  limit?: number
  excludeSystem?: boolean
  types?: string[]
}

export interface ClickHouseDatabaseInfo { name: string }
export interface ClickHouseTableInfo { name: string; type: string; engine?: string }

export interface ClickHouseTreeDatabasesResult { databases: ClickHouseDatabaseInfo[]; truncated?: boolean }
export interface ClickHouseTreeTablesResult { tables: ClickHouseTableInfo[]; truncated?: boolean }
export interface ClickHouseTreeDictionariesResult { dictionaries: ClickHouseTableInfo[]; truncated?: boolean }
export interface ClickHouseTreeCategoryCountsResult {
  tables: number
  views: number
  materializedViews: number
  dictionaries: number
}

export interface ClickHouseCatalogListParams {
  sessionId: string
  schema?: string
  table?: string
  prefix?: string
  limit?: number
  types?: string[]
}
export interface ClickHouseCatalogSchemasResult { schemas: Array<{ name: string }>; truncated?: boolean }
export interface ClickHouseCatalogTablesResult {
  tables: Array<{ name: string; type?: string }>
  truncated?: boolean
}
export interface ClickHouseCatalogColumnsResult {
  columns: Array<{ name: string; dataType?: string; nullable?: boolean }>
  truncated?: boolean
}

export interface ClickHouseMetaRelationParams {
  sessionId: string
  database: string
  table?: string
  name?: string
}

export interface ClickHouseColumnInfo {
  ordinal: number
  name: string
  dataType: string
  nullable: boolean
  default?: string | null
  comment?: string
}

export interface ClickHouseMetaColumnsResult {
  columns: ClickHouseColumnInfo[]
  tableComment?: string
}

export interface ClickHouseTableMetaInfo {
  database: string
  name: string
  engine?: string
  partitionKey?: string
  sortingKey?: string
  primaryKey?: string
  totalRows?: number
  totalBytes?: number
  comment?: string
  objectType?: string
}

export interface ClickHouseProcessInfo {
  queryId: string
  user: string
  host: string
  address?: string | null
  db?: string | null
  queryKind?: string | null
  elapsed: number
  startTime?: string
  readRows?: number | null
  readBytes?: number | null
  writtenRows?: number | null
  writtenBytes?: number | null
  memoryUsage?: number | null
  peakMemoryUsage?: number | null
  isCancelled?: boolean | null
  query?: string | null
}

export interface ClickHouseMetaProcessesParams {
  sessionId: string
}
export interface ClickHouseMetaProcessesResult {
  processes: ClickHouseProcessInfo[]
}

export interface ClickHouseDiskInfo {
  name: string
  path?: string
  type?: string
  totalBytes: number
  freeBytes: number
  usedBytes: number
}

export interface ClickHouseMetaInstanceOverviewResult {
  version: string
  currentUser?: string
  currentDatabase?: string
  hostName?: string
  serverAddr?: string
  uptimeSeconds?: number | null
  databaseCount?: number | null
  tableCount?: number | null
  dictionaryCount?: number | null
  processCount?: number | null
  memoryTracking?: number | null
  clusterCount?: number | null
  maxServerMemoryBytes?: number | null
  osMemoryTotalBytes?: number | null
  queryMetric?: number | null
  mergeMetric?: number | null
  partMutationMetric?: number | null
  delayedInserts?: number | null
  readonlyReplicaMetric?: number | null
  activeParts?: number | null
  maxPartsInPartition?: number | null
  mergeTreeBytes?: number | null
  runningMerges?: number | null
  replicaTableCount?: number | null
  readonlyReplicaTables?: number | null
  maxReplicaDelaySecs?: number | null
  diskTotalBytes?: number | null
  diskFreeBytes?: number | null
  diskUsedBytes?: number | null
  disks?: ClickHouseDiskInfo[]
  partial?: boolean
  warnings?: string[]
}

export interface ClickHouseMetaKillParams {
  sessionId: string
  queryId: string
}
export interface ClickHouseMetaKillResult {
  killed: boolean
  queryId: string
}

export interface ClickHouseClusterHostInfo {
  cluster: string
  shardNum: number
  replicaNum: number
  hostName: string
  hostAddress?: string
  port?: number
  isLocal?: boolean
  errorsCount?: number
}

export interface ClickHouseMetaClustersParams {
  sessionId: string
}
export interface ClickHouseMetaClustersResult {
  hosts: ClickHouseClusterHostInfo[]
}

export interface ClickHouseMergeInfo {
  database: string
  table: string
  elapsed: number
  startTime?: string
  progress: number
  numParts: number
  isMutation: boolean
  totalSizeBytesCompressed?: number | null
  bytesReadUncompressed?: number | null
  rowsRead?: number | null
  resultPartName?: string
  partitionId?: string
}

export interface ClickHouseMetaMergesParams {
  sessionId: string
}
export interface ClickHouseMetaMergesResult {
  merges: ClickHouseMergeInfo[]
}

export interface ClickHouseMutationInfo {
  database: string
  table: string
  mutationId: string
  command?: string
  createTime?: string
  elapsedSecs?: number
  partsToDo: number
  isDone: boolean
  latestFailedPart?: string
  latestFailReason?: string
  latestFailTime?: string
}

export interface ClickHouseMetaMutationsParams {
  sessionId: string
}
export interface ClickHouseMetaMutationsResult {
  mutations: ClickHouseMutationInfo[]
}

export interface ClickHouseReplicaInfo {
  database: string
  table: string
  isLeader: boolean
  isReadonly: boolean
  absoluteDelay: number
  queueSize: number
  insertsInQueue: number
  mergesInQueue: number
  totalReplicas: number
  activeReplicas: number
  zookeeperException?: string
}

export interface ClickHouseMetaReplicasParams {
  sessionId: string
}
export interface ClickHouseMetaReplicasResult {
  replicas: ClickHouseReplicaInfo[]
}

export interface ClickHousePartsTableInfo {
  database: string
  table: string
  parts: number
  rows: number
  bytesOnDisk: number
  partitions: number
}

export interface ClickHouseMetaPartsParams {
  sessionId: string
}
export interface ClickHouseMetaPartsResult {
  tables: ClickHousePartsTableInfo[]
  partial?: boolean
  warnings?: string[]
}

export interface ClickHouseMetricsSnapshotResult {
  tsMs: number
  memoryTracking?: number | null
  queryMetric?: number | null
  mergeMetric?: number | null
  delayedInserts?: number | null
  processCount?: number | null
  runningMerges?: number | null
  maxPartsInPartition?: number | null
  maxReplicaDelaySecs?: number | null
}

export interface ClickHouseMetaMetricsSnapshotParams {
  sessionId: string
}

export interface ClickHouseSlowQueryInfo {
  queryId: string
  user: string
  startTime?: string
  eventTime: string
  durationMs: number
  readRows: number
  readBytes: number
  writtenRows: number
  writtenBytes: number
  memoryUsage: number
  peakMemoryUsage: number
  type: string
  exception?: string
  query?: string
}

export interface ClickHouseMetaSlowQueriesParams {
  sessionId: string
  windowMinutes?: number
  minDurationMs?: number
  limit?: number
}

export interface ClickHouseMetaSlowQueriesResult {
  queries: ClickHouseSlowQueryInfo[]
  windowMinutes: number
  minDurationMs: number
  truncated?: boolean
}

export interface ClickHouseIndexInfo {
  name: string
  type?: string
  expression?: string
  definition?: string
}

export interface ClickHouseMetaIndexesResult {
  indexes: ClickHouseIndexInfo[]
}

export interface ClickHouseMetaDDLResult {
  objectType: string
  ddl: string
  type?: string
}

// ─── DDL: table design ───────────────────────────────────────────────────────

export type ClickHouseDesignOpKind =
  | 'add_column'
  | 'drop_column'
  | 'rename_column'
  | 'modify_column'
  | 'set_table_comment'
  | 'set_order_by'
  | 'add_index'
  | 'drop_index'

export interface ClickHouseDesignOp {
  op: ClickHouseDesignOpKind
  name?: string
  newName?: string
  dataType?: string
  default?: string | null
  comment?: string
  expression?: string
  /** 跳数索引类型（minmax / set / bloom_filter / …） */
  type?: string
  granularity?: number
}

export interface ClickHouseDesignColumnSpec {
  name: string
  dataType: string
  default?: string | null
  comment?: string
  /** 列级 CODEC，如 ZSTD / LZ4 */
  codec?: string
}

export interface ClickHouseDesignIndexSpec {
  name: string
  expression: string
  type: string
  granularity?: number
}

export interface ClickHouseDdlDesignParams {
  sessionId?: string
  database: string
  name: string
  ops: ClickHouseDesignOp[]
  cluster?: string
}

export interface ClickHouseDdlCreateTableParams {
  sessionId?: string
  database: string
  name: string
  columns: ClickHouseDesignColumnSpec[]
  indexes?: ClickHouseDesignIndexSpec[]
  engine?: string
  orderBy: string
  partitionBy?: string
  primaryKey?: string
  sampleBy?: string
  ttl?: string
  settings?: string
  comment?: string
  cluster?: string
}

export interface ClickHouseDdlSqlResult {
  sql: string[]
  durationMs?: number
}

/** 对象脚本预览 / 应用（视图 / MV / 字典） */
export interface ClickHouseObjectScriptParams {
  sessionId?: string
  kind: 'view' | 'materializedView' | 'dictionary'
  sql: string
  database?: string
  /** 编辑态当前对象名；与 SQL 内名称不同时先 DROP 旧名 */
  existingName?: string
  mode?: 'create' | 'alter'
  cluster?: string
  selectionOnly?: boolean
  preferFallback?: boolean
}

export interface ClickHouseObjectScriptResult {
  sql: string[]
  strategy: 'or_replace' | 'drop_create' | 'raw' | string
  durationMs?: number
}

// ─── IO: import / export ────────────────────────────────────────────────────

/** 导入文件格式：无自定义列映射时走 INSERT … FORMAT 快路径 */
export type ClickHouseIoImportFormat = 'csv' | 'tsv' | 'json_each_row' | 'parquet'

export interface ClickHouseIoCsvOptions {
  header?: boolean
  delimiter?: string
  nullString?: string
  truncate?: boolean
  /** 文件编码：utf-8（默认）| gbk */
  encoding?: string
  /** csv | tsv | json_each_row | parquet */
  format?: ClickHouseIoImportFormat | string
  /** 跳过文件开头的数据行（表头由 header/WithNames 处理） */
  skipRows?: number
  /** 允许的错误行数（input_format_allow_errors_num） */
  maxErrors?: number
  /** CSV 表头（或 col1…）→ 表列名；空映射跳过该源列；有映射时走 PrepareBatch */
  columnMap?: Record<string, string>
}

export type ClickHouseIoDumpMode = 'structure_and_data' | 'structure_only' | 'data_only'

export interface ClickHouseIoExportCsvParams {
  sessionId?: string
  profileId?: string
  database: string
  table: string
  outputPath: string
  csvOptions?: ClickHouseIoCsvOptions
}

export interface ClickHouseIoImportCsvParams {
  sessionId?: string
  profileId?: string
  database: string
  table: string
  inputPath: string
  csvOptions?: ClickHouseIoCsvOptions
}

export interface ClickHouseIoDumpSqlParams {
  sessionId?: string
  profileId?: string
  dump: {
    database: string
    tables?: string[]
    mode: ClickHouseIoDumpMode
    outputPath: string
    dropIfExists?: boolean
    truncateBeforeData?: boolean
    includeCreateDatabase?: boolean
    includeTables?: boolean
    includeViews?: boolean
    includeMaterializedViews?: boolean
    includeDictionaries?: boolean
  }
}

export interface ClickHouseIoExecSqlFileParams {
  sessionId?: string
  profileId?: string
  database: string
  inputPath: string
  execOptions?: { continueOnError?: boolean }
}

export interface ClickHouseIoTaskResult {
  taskId: string
}

export interface ClickHouseIoCancelParams {
  sessionId?: string
  profileId?: string
  taskId: string
}

export interface ClickHouseIoProgressEvent {
  type: string
  taskId: string
  phase: string
  message?: string
}

export interface ClickHouseIoDoneEvent {
  type: string
  taskId: string
  ok: boolean
  message?: string
  outputPath?: string
}

/** SQL Language Server（Bridge 隧道 LSP） */
export interface ClickHouseLspOpenParams {
  sessionId: string
  clientId: string
  /** 编辑器当前 database；可空 */
  database?: string
}

export interface ClickHouseLspOpenResult {
  connectionId: string
}

export interface ClickHouseLspRpcParams {
  connectionId: string
  sessionId: string
  message: Record<string, unknown>
}

export interface ClickHouseLspRpcResult {
  ok?: boolean
  message?: Record<string, unknown>
}

export interface ClickHouseLspCloseParams {
  connectionId: string
  sessionId?: string
}

export interface ClickHouseLspLexiconParams {
  sessionId?: string
}

export interface ClickHouseLspLexiconResult {
  keywords: string[]
  functions: string[]
}

/** 外部 clickhouse-client */
export interface ClickHouseToolsDetectParams {
  toolPaths?: Record<string, string>
}

export interface ClickHouseToolsDetectResult {
  clickhouseClient: {
    available: boolean
    path?: string
    version?: string
  }
}

export interface ClickHouseToolsDumpOptions {
  mode?: 'all' | 'structure_only' | 'data_only'
  tables?: string[]
}

export interface ClickHouseToolsDumpParams {
  sessionId: string
  database: string
  outputPath: string
  dumpOptions?: ClickHouseToolsDumpOptions
  toolPaths?: Record<string, string>
}

export interface ClickHouseToolsRestoreParams {
  sessionId: string
  database: string
  inputPath: string
  restoreOptions?: { multiquery?: boolean }
  toolPaths?: Record<string, string>
}

export interface ClickHouseToolsTaskResult {
  taskId: string
}

export interface ClickHouseToolsCancelParams {
  sessionId?: string
  taskId: string
}
