/**
 * MongoDB 能力类型 —— `mongodb.*` Bridge 契约（对应 `services/mongodb-service`）。
 */
import type { ConnectionOptionsBase } from './connection'

export type {
  ConnectionCreateParams,
  ConnectionCreateResult,
  ConnectionDeleteParams,
  ConnectionDeleteResult,
  ConnectionGetParams,
  ConnectionGetResult,
  ConnectionListParams,
  ConnectionListResult,
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionUpdateParams,
  ConnectionUpdateResult,
  CredentialDeleteParams,
  CredentialDeleteResult,
  CredentialInput,
  CredentialSetParams,
  CredentialSetResult,
  ProxyOptions,
  ProxyType,
} from './connection'

export { DEFAULT_PROXY_OPTIONS, defaultProxyPort } from './connection'

/** MongoDB 部署拓扑 */
export type MongoTopology = 'standalone' | 'replica_set' | 'sharded'

/** MongoDB 认证机制 */
export type MongoAuthMechanism = 'default' | 'scram' | 'x509' | 'ldap' | 'kerberos'

/** MongoDB 读偏好 */
export type MongoReadPreference =
  | 'primary'
  | 'primaryPreferred'
  | 'secondary'
  | 'secondaryPreferred'
  | 'nearest'

/** MongoDB 客户端驱动模式 */
export type MongoClientDriver = 'default' | 'legacy'

/**
 * MongoDB 连接选项（存于 connection_options JSON）。
 * 协议专属字段统一 **snake_case**。
 */
export interface MongoConnectionOptions extends ConnectionOptionsBase {
  topology: MongoTopology
  auth_mechanism: MongoAuthMechanism
  auth_database: string
  replica_set: string
  read_preference: MongoReadPreference
  srv_record: boolean
  timeout_seconds: number
  client_driver: MongoClientDriver
  default_database: string
  tool_paths?: Record<string, string>
  /** @deprecated 历史 camelCase，读取兼容 */
  timeoutSeconds?: number
}

/** 默认 MongoDB 连接选项 */
export const DEFAULT_MONGO_OPTIONS: MongoConnectionOptions = {
  topology: 'standalone',
  auth_mechanism: 'default',
  auth_database: 'admin',
  replica_set: '',
  read_preference: 'primary',
  srv_record: false,
  timeout_seconds: 10,
  client_driver: 'default',
  default_database: '',
  proxy: { type: 'none' },
}

export interface MongoSessionOpenParams {
  profileId: string
}

export interface MongoSessionOpenResult {
  sessionId: string
}

export interface MongoSessionCloseParams {
  sessionId: string
}

export interface MongoSessionTestParams {
  hostAddress: string
  portNumber: number
  loginAccount?: string
  options?: MongoConnectionOptions
}

export interface MongoSessionTestResult {
  ok: boolean
  message: string
}

export interface MongoTreeDatabasesParams {
  profileId: string
}

export interface MongoDatabaseInfo {
  name: string
  sizeOnDisk: number
  empty: boolean
}

export interface MongoTreeDatabasesResult {
  databases: MongoDatabaseInfo[]
}

export interface MongoTreeCollectionsParams {
  profileId?: string
  sessionId?: string
  database: string
}

export interface MongoCollectionInfo {
  name: string
  type: string
  count?: number
  /** 存储占用（字节） */
  storageSize?: number
  /** 平均文档大小（字节） */
  avgObjSize?: number
  /** 索引数量 */
  indexCount?: number
  /** 索引总大小（字节） */
  indexSize?: number
}

export interface MongoTreeCollectionsResult {
  collections: MongoCollectionInfo[]
}

/** Relaxed Extended JSON 文档（Bridge 层 JSON 对象） */
export type MongoDocument = Record<string, unknown>

export interface MongoDocumentFindParams {
  sessionId: string
  database: string
  collection: string
  filter?: MongoDocument
  sort?: Record<string, 1 | -1>
  projection?: MongoDocument
  skip?: number
  limit?: number
}

export interface MongoDocumentFindResult {
  documents: MongoDocument[]
  total?: number
  hasMore: boolean
}

export interface MongoDocumentGetParams {
  sessionId: string
  database: string
  collection: string
  id: unknown
}

export interface MongoDocumentGetResult {
  document: MongoDocument
}

export interface MongoDocumentInsertParams {
  sessionId: string
  database: string
  collection: string
  document: MongoDocument
}

export interface MongoDocumentInsertResult {
  insertedId: unknown
}

export interface MongoDocumentUpdateParams {
  sessionId: string
  database: string
  collection: string
  id: unknown
  document: MongoDocument
}

export interface MongoDocumentUpdateResult {
  matched: number
  modified: number
}

export interface MongoDocumentDeleteParams {
  sessionId: string
  database: string
  collection: string
  id: unknown
}

export interface MongoDocumentDeleteResult {
  deleted: number
}

/** index.list 返回的单条索引摘要 */
export interface MongoIndexInfo {
  name: string
  /** 索引键定义（Extended JSON 对象，保留字段顺序） */
  keys: Record<string, unknown>
  unique?: boolean
  sparse?: boolean
  /** TTL 索引过期秒数；非 TTL 索引缺省 */
  expireAfterSeconds?: number
  /** 完整索引定义（原始 listIndexes 文档） */
  raw: Record<string, unknown>
}

export interface MongoIndexListParams {
  sessionId: string
  database: string
  collection: string
}

export interface MongoIndexListResult {
  indexes: MongoIndexInfo[]
}

export interface MongoIndexCreateParams {
  sessionId: string
  database: string
  collection: string
  /** 索引键（如 { userId: 1, createdAt: -1 }），顺序敏感 */
  keys: Record<string, unknown>
  name?: string
  unique?: boolean
  sparse?: boolean
  expireAfterSeconds?: number
}

export interface MongoIndexCreateResult {
  name: string
}

export interface MongoIndexDropParams {
  sessionId: string
  database: string
  collection: string
  name: string
}

export interface MongoIndexDropResult {
  dropped: boolean
}

export interface MongoAggregateRunParams {
  sessionId: string
  database: string
  collection: string
  pipeline: unknown[]
}

export interface MongoAggregateRunResult {
  documents: MongoDocument[]
}

export interface MongoAggregateExplainParams {
  sessionId: string
  database: string
  collection: string
  pipeline: unknown[]
}

export interface MongoAggregateExplainResult {
  explain: MongoDocument
}

export interface MongoMonitorStatsParams {
  sessionId: string
  database?: string
}

export interface MongoMonitorStatsResult {
  serverStatus: Record<string, unknown>
  dbStats: Record<string, unknown>
  database: string
}

export interface MongoMonitorCurrentOpParams {
  sessionId: string
  activeOnly?: boolean
}

export interface MongoMonitorCurrentOpResult {
  operations: unknown[]
  raw?: MongoDocument
}

export interface MongoMonitorSlowLogParams {
  sessionId: string
  database?: string
  count?: number
}

export interface MongoProfilingStatus {
  level: number
  slowms: number
  enabled: boolean
}

export interface MongoSlowLogEntry {
  timestamp?: string
  durationMs: number
  op: string
  ns: string
  command?: string
  user?: string
  client?: string
  planSummary?: string
  raw?: Record<string, unknown>
}

export interface MongoMonitorSlowLogResult {
  database: string
  profiling: MongoProfilingStatus
  entries: MongoSlowLogEntry[]
}

export interface MongoProfilerStatusParams {
  sessionId: string
  database?: string
}

export interface MongoProfilerStatusResult {
  database: string
  profiling: MongoProfilingStatus
}

export interface MongoProfilerSetParams {
  sessionId: string
  database?: string
  enabled: boolean
  slowms?: number
}

export interface MongoProfilerSetResult {
  database: string
  profiling: MongoProfilingStatus
}

export interface MongoSchemaSampleParams {
  sessionId: string
  database: string
  collection: string
  sampleSize?: number
  filter?: unknown
  maxTimeMS?: number
}

export interface MongoSchemaTypeStat {
  type: string
  frequency: number
}

export interface MongoSchemaNumberBucket {
  from: number
  to: number
  frequency: number
}

export interface MongoSchemaNumberStats {
  min: number
  max: number
  buckets?: MongoSchemaNumberBucket[]
}

export interface MongoSchemaDateStats {
  min: string
  max: string
  buckets?: MongoSchemaDateBucket[]
}

export interface MongoSchemaDateBucket {
  from: string
  to: string
  frequency: number
}

export interface MongoSchemaGeoPoint {
  lng: number
  lat: number
}

export interface MongoSchemaGeoStats {
  points: MongoSchemaGeoPoint[]
}

export interface MongoSchemaStringBucket {
  value: string
  frequency: number
}

export interface MongoSchemaStringStats {
  topValues: MongoSchemaStringBucket[]
}

export interface MongoSchemaField {
  path: string
  types: string[]
  frequency: number
  typeBreakdown?: MongoSchemaTypeStat[]
  numberStats?: MongoSchemaNumberStats
  dateStats?: MongoSchemaDateStats
  stringStats?: MongoSchemaStringStats
  geoStats?: MongoSchemaGeoStats
  samples?: string[]
}

export interface MongoSchemaSampleResult {
  fields: MongoSchemaField[]
  sampleCount: number
  sampleSize: number
}

export interface MongoSchemaValidatorParams {
  sessionId: string
  database: string
  collection: string
}

export interface MongoSchemaValidator {
  validator?: Record<string, unknown>
  validationLevel?: string
  validationAction?: string
}

export interface MongoSchemaValidatorSetParams extends MongoSchemaValidatorParams {
  validator: unknown
  validationLevel?: string
  validationAction?: string
}

export interface MongoSchemaValidatorSetResult {
  applied: boolean
}

export interface MongoPipelineSuggestParams {
  sessionId: string
  database: string
  collection: string
  text: string
  line: number
  column: number
  prefix?: string
  triggerCharacter?: string
}

export interface MongoPipelineSuggestion {
  label: string
  insertText: string
  detail?: string
  documentation?: string
  filterText?: string
  sortText?: string
  kind?: 'snippet' | 'keyword' | 'property' | 'field' | 'function' | 'value'
}

export interface MongoPipelineSuggestResult {
  suggestions: MongoPipelineSuggestion[]
  context?: string
}

export interface MongoQuerySuggestParams {
  sessionId: string
  database: string
  collection: string
  text: string
  line: number
  column: number
  prefix?: string
  triggerCharacter?: string
}

export interface MongoQuerySuggestResult {
  suggestions: MongoPipelineSuggestion[]
  context?: string
}

export interface MongoQueryExecParams {
  sessionId: string
  database: string
  input: string
  explain?: boolean
  toolPaths?: Record<string, string>
}

export interface MongoQueryExecResult {
  documents?: unknown[]
  document?: unknown
  explain?: unknown
  count?: number
  output?: string
  engine?: 'mongosh' | 'driver' | string
}

export interface MongoCommandExecParams {
  sessionId: string
  input: string
}

export interface MongoCommandExecResult {
  output: string
  error?: string
}

export interface MongoCommandSuggestParams {
  sessionId: string
  input: string
}

export interface MongoCommandSuggestResult {
  suggestions: string[]
}

export interface MongoToolDetectEntry {
  available: boolean
  path?: string
  version?: string
}

export interface MongoShellDetectParams {
  toolPaths?: Record<string, string>
}

export interface MongoShellDetectResult extends MongoToolDetectEntry {
  /** 当前平台是否支持交互式 PTY；Windows 上为 false */
  ptySupported?: boolean
}

export interface MongoShellOpenParams {
  sessionId: string
  cols: number
  rows: number
  toolPaths?: Record<string, string>
}

export interface MongoShellOpenResult {
  shellId: string
}

export interface MongoShellInputParams {
  shellId: string
  data: string
}

export interface MongoShellResizeParams {
  shellId: string
  cols: number
  rows: number
}

export interface MongoShellCloseParams {
  shellId: string
}

export interface MongoShellOutputEvent {
  type: 'mongodb.shell.output'
  shellId: string
  data: string
}

export interface MongoShellStateEvent {
  type: 'mongodb.shell.state'
  shellId: string
  state: 'opening' | 'connected' | 'closed'
}

export interface MongoToolsDetectParams {
  toolPaths?: Record<string, string>
}

export interface MongoToolsDetectResult {
  mongodump: MongoToolDetectEntry
  mongorestore: MongoToolDetectEntry
  mongoexport: MongoToolDetectEntry
  mongoimport: MongoToolDetectEntry
}

export interface MongoToolsDumpParams {
  sessionId: string
  database: string
  outputDir?: string
  options?: Record<string, unknown>
  toolPaths?: Record<string, string>
}

export interface MongoToolsRestoreParams {
  sessionId: string
  inputDir: string
  options?: Record<string, unknown>
  toolPaths?: Record<string, string>
}

export interface MongoToolsExportParams {
  sessionId: string
  database: string
  collection: string
  format: 'json' | 'csv'
  outputPath?: string
  toolPaths?: Record<string, string>
}

export interface MongoToolsImportParams {
  sessionId: string
  database: string
  collection: string
  format: 'json' | 'csv'
  inputPath: string
  toolPaths?: Record<string, string>
}

export interface MongoToolsTaskResult {
  taskId: string
}

export interface MongoToolsCancelParams {
  taskId: string
}

export interface MongoToolsProgressEvent {
  type: 'mongodb.tools.progress'
  taskId: string
  phase: string
  percent?: number
  message?: string
}

export interface MongoToolsDoneEvent {
  type: 'mongodb.tools.done'
  taskId: string
  ok: boolean
  message?: string
  outputPath?: string
}

export interface MongoMonitorStreamStartParams {
  sessionId: string
  database: string
  collection: string
  pipeline?: unknown[]
}

export interface MongoMonitorStreamStartResult {
  streamId: string
}

export interface MongoMonitorStreamStopParams {
  streamId: string
}

export interface MongoMonitorStreamStopResult {
  stopped: boolean
}

export type MongoChangeStreamState = 'idle' | 'starting' | 'ready' | 'closed' | 'lost'

export interface MongoMonitorStateEvent {
  type: 'mongodb.monitor.state'
  streamId: string
  sessionId: string
  state: 'ready' | 'closed' | 'lost'
  message: string
}

export interface MongoMonitorEvent {
  type: 'mongodb.monitor.event'
  streamId: string
  document: Record<string, unknown>
}

export type MongoMonitorStreamEvent = MongoMonitorStateEvent | MongoMonitorEvent
