/**
 * Redis 能力类型 —— `redis.*` Bridge 契约（对应 `services/redis-service`）。
 *
 * 连接站点 / 凭据 / 代理公共类型见 `./connection`。
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

/** Redis 部署拓扑 */
export type RedisTopology = 'standalone' | 'sentinel' | 'cluster'

/**
 * Redis 连接选项（存于 connection_options JSON）。
 *
 * 注意：platform-core 的凭据注入信封固定为 `{hostAddress, portNumber, loginAccount,
 * password, options}` 且 `options` 整段透传，不按连接类型展开字段，所以 Redis 专属的
 * `database`/`topology`/`sentinel_master_name`/`nodes` 都放在这里（而不是顶层），
 * 与 redis-service 的 `ConnectOptions` 结构一一对应。
 * 协议专属字段统一 **snake_case**；历史 camelCase 字段仅读取兼容。
 */
export interface RedisConnectionOptions extends ConnectionOptionsBase {
  /** 逻辑库编号（0-15），standalone/sentinel 有效；cluster 恒为 0 */
  database: number
  topology: RedisTopology
  /** 建连拨号超时（秒）；redis-service 已生效 */
  timeout_seconds: number
  /** sentinel 拓扑下的主节点名 */
  sentinel_master_name: string
  /** 额外种子节点（`host:port`），补充主机地址，用于 sentinel/cluster 拓扑 */
  nodes: string[]
  /**
   * @deprecated 历史 camelCase，读取兼容；新保存请使用 `timeout_seconds`
   */
  timeoutSeconds?: number
  /**
   * @deprecated 历史 camelCase，读取兼容；新保存请使用 `sentinel_master_name`
   */
  sentinelMasterName?: string
}

/** 默认 Redis 连接选项 */
export const DEFAULT_REDIS_OPTIONS: RedisConnectionOptions = {
  database: 0,
  topology: 'standalone',
  timeout_seconds: 10,
  sentinel_master_name: '',
  nodes: [],
  proxy: { type: 'none' },
}

/** `redis.tree.databases` 入参（凭据由 platform 注入） */
export interface RedisTreeDatabasesParams {
  profileId: string
}

/** `redis.tree.databases` 返回 */
export interface RedisTreeDatabasesResult {
  databaseCount: number
  defaultDatabase: number
  keyspace: Array<{ db: number; keys: number }>
}

/** `redis.session.open` 入参（凭据从 profileId 对应站点注入） */
export interface RedisSessionOpenParams {
  profileId: string
}

/** `redis.session.open` 返回 */
export interface RedisSessionOpenResult {
  sessionId: string
}

/** `redis.session.close` 入参 */
export interface RedisSessionCloseParams {
  sessionId: string
}

/** `redis.session.test` 入参（已保存站点用 profileId；新建/改密时用内联连接参数） */
export interface RedisSessionTestParams {
  profileId?: string
  hostAddress?: string
  portNumber?: number
  loginAccount?: string
  /** 认证凭据；新字段名为 `secret`。 */
  secret?: string
  options?: RedisConnectionOptions
}

/** `redis.session.test` 返回 */
export interface RedisSessionTestResult {
  ok: boolean
  message: string
}

/** `redis.command.exec` 入参：`args[0]` 为命令名，其余为参数（已按 shell 语义切分好） */
export interface RedisCommandExecParams {
  sessionId: string
  args: string[]
}

/** `redis.command.exec` 返回：`reply` 的具体形状取决于命令语义，见 `RedisReplyValue` */
export interface RedisCommandExecResult {
  reply: RedisReplyValue
  elapsedMs: number
}

/**
 * Redis 回复的 JSON 化表示（对应后端 `redis_value_to_json`）：
 * - `null` / 数字 / 字符串 / 布尔 直接对应对应的 RESP 类型
 * - 数组/嵌套数组对应 `Array`/`Set`/`Push`
 * - 对象对应 `Map`（RESP3）
 * - 超大或非 UTF-8 的 bulk string 会被包装为 `{ text, isUtf8, truncated, byteLength }`
 */
export type RedisReplyValue =
  | null
  | number
  | string
  | boolean
  | RedisReplyValue[]
  | { [key: string]: RedisReplyValue }
  | { text: string; isUtf8: boolean; truncated: boolean; byteLength: number }

/** `redis.command.suggest` 入参 */
export interface RedisCommandSuggestParams {
  /** 当前输入的完整命令行文本（未必是一条完整命令） */
  input: string
  /** 可选：提供后优先使用该会话连接的服务器自身 `COMMAND DOCS`，未提供则使用内置静态表 */
  sessionId?: string
}

/** 单条命令补全建议 */
export interface RedisCommandSuggestion {
  /** 顶层命令为命令名本身；子命令为 `"PARENT SUB"` 形式（如 `"CONFIG GET"`） */
  name: string
  summary: string
  /** 完整参数签名（未按已输入内容收窄） */
  arguments: string
  since: string
  group: string
  /** 根据已输入的参数数量收窄后的剩余参数提示；命令名本身未输入完整时不返回该字段 */
  remainingArguments?: string
  /** 仅子命令建议才有：父命令名，如 `"CONFIG"` */
  parentCommand?: string
  /** 仅子命令建议才有：子命令名，如 `"GET"` */
  subcommand?: string
}

/** `redis.command.suggest` 返回 */
export interface RedisCommandSuggestResult {
  suggestions: RedisCommandSuggestion[]
}

/** `redis.monitor.metrics` 入参 */
export interface RedisMonitorMetricsParams {
  sessionId: string
}

/** 单个逻辑库的 keyspace 概览（`INFO keyspace` 的 `dbN:` 行） */
export interface RedisKeyspaceDbMetric {
  db: number
  keys: number
  expires: number
  avgTtlMs: number
}

/** `redis.monitor.metrics` 返回（对应后端 `parse_info_metrics`） */
export interface RedisMonitorMetricsResult {
  redisVersion: string
  role: string
  uptimeSeconds: number
  connectedClients: number
  blockedClients: number
  connectedSlaves: number
  usedMemory: number
  usedMemoryHuman: string
  usedMemoryRss: number
  usedMemoryPeak: number
  maxMemory: number
  maxMemoryPolicy: string
  memFragmentationRatio: number
  totalConnectionsReceived: number
  totalCommandsProcessed: number
  instantaneousOpsPerSec: number
  totalNetInputBytes: number
  totalNetOutputBytes: number
  rejectedConnections: number
  expiredKeys: number
  evictedKeys: number
  keyspaceHits: number
  keyspaceMisses: number
  keyspaceHitRate: number
  latestForkUsec: number
  masterReplOffset: number
  usedCpuSys: number
  usedCpuUser: number
  keyspace: RedisKeyspaceDbMetric[]
}

/** `redis.monitor.slowlog` 入参 */
export interface RedisMonitorSlowlogParams {
  sessionId: string
  /** 返回条数上限，默认 20，服务端硬顶 500 */
  count?: number
}

/** 单条慢查询日志 */
export interface RedisSlowlogEntry {
  id: number
  /** Unix 秒级时间戳 */
  timestamp: number
  durationUs: number
  command: string[]
  clientAddr: string
  clientName: string
}

/** `redis.monitor.slowlog` 返回 */
export interface RedisMonitorSlowlogResult {
  entries: RedisSlowlogEntry[]
}

/** `redis.monitor.stream.start` 入参 */
export interface RedisMonitorStreamStartParams {
  sessionId: string
}

/** `redis.monitor.stream.start` 返回 */
export interface RedisMonitorStreamStartResult {
  monitorId: string
}

/** `redis.monitor.stream.stop` 入参 */
export interface RedisMonitorStreamStopParams {
  monitorId: string
}

/** `redis.keyspace.scan` 入参 */
export interface RedisKeyspaceScanParams {
  sessionId: string
  /** `SCAN` 游标，0 表示从头开始 */
  cursor?: number
  /** `MATCH` 通配符模式 */
  match?: string
  /** 单批 `COUNT` 提示，默认 100，服务端硬顶 1000 */
  count?: number
  /** `TYPE` 过滤（如 `string`/`hash`/`list`/`set`/`zset`/`stream`） */
  type?: string
}

/** 单个 key 的描述信息（附带类型/TTL/近似大小） */
export interface RedisKeyDescriptor {
  key: string
  type: string
  /** 剩余存活毫秒数；-1 表示无过期时间，-2 表示 key 不存在（竞态下已被删除） */
  ttlMs: number
  sizeBytes: number
}

/** `redis.keyspace.scan` 返回 */
export interface RedisKeyspaceScanResult {
  /** 下一次调用应传入的游标；为 0 表示本轮遍历已结束 */
  cursor: number
  keys: RedisKeyDescriptor[]
}

/** MONITOR 流状态事件（`redis.monitor.state`） */
export interface RedisMonitorStateEvent {
  type: 'redis.monitor.state'
  sessionId: string
  monitorId: string
  state: 'ready' | 'closed' | 'lost'
  message: string
}

/** MONITOR 流一条命令事件（`redis.monitor.line`） */
export interface RedisMonitorLineEvent {
  type: 'redis.monitor.line'
  sessionId: string
  monitorId: string
  data: {
    /** 命令执行时刻的 Unix 时间戳（秒，含微秒小数部分） */
    timestamp: number
    db: number
    /** 客户端地址，如 `127.0.0.1:52341`，Lua 脚本内部调用时为 `lua` */
    client: string
    command: string[]
    /** 命令参数超过后端上限（64 个）时为 `true`，此时 `command` 已被截断 */
    truncated: boolean
  }
}

export type RedisMonitorEvent = RedisMonitorStateEvent | RedisMonitorLineEvent
