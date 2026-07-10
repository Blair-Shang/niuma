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

export interface MongoSchemaSampleParams {
  sessionId: string
  database: string
  collection: string
  sampleSize?: number
}

export interface MongoSchemaField {
  path: string
  types: string[]
  frequency: number
}

export interface MongoSchemaSampleResult {
  fields: MongoSchemaField[]
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

export interface MongoShellDetectResult extends MongoToolDetectEntry {}

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

export interface MongoMonitorEvent {
  type: 'mongodb.monitor.event'
  streamId: string
  document: Record<string, unknown>
}
