import { bridgeInvoke } from '@/api/client'
import type {
  RedisCommandExecParams,
  RedisCommandExecResult,
  RedisCommandSuggestParams,
  RedisCommandSuggestResult,
  RedisKeyspaceScanParams,
  RedisKeyspaceScanResult,
  RedisMonitorMetricsParams,
  RedisMonitorMetricsResult,
  RedisMonitorSlowlogParams,
  RedisMonitorSlowlogResult,
  RedisMonitorStreamStartParams,
  RedisMonitorStreamStartResult,
  RedisMonitorStreamStopParams,
  RedisSessionCloseParams,
  RedisSessionOpenParams,
  RedisSessionOpenResult,
  RedisSessionTestParams,
  RedisSessionTestResult,
  RedisTreeDatabasesParams,
  RedisTreeDatabasesResult,
} from '@/api/types/redis'

/**
 * Redis 会话、命令执行与监控能力（platform-core 代理至 redis-service）。
 */
export const redisApi = {
  sessionOpen(params: RedisSessionOpenParams): Promise<RedisSessionOpenResult> {
    return bridgeInvoke<RedisSessionOpenResult>('redis.session.open', params)
  },

  sessionClose(params: RedisSessionCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('redis.session.close', params)
  },

  sessionTest(params: RedisSessionTestParams): Promise<RedisSessionTestResult> {
    return bridgeInvoke<RedisSessionTestResult>('redis.session.test', params)
  },

  /** 列出逻辑库概览（短连接探测，供连接树懒加载）。 */
  treeDatabases(params: RedisTreeDatabasesParams): Promise<RedisTreeDatabasesResult> {
    return bridgeInvoke<RedisTreeDatabasesResult>('redis.tree.databases', params)
  },

  commandExec(params: RedisCommandExecParams): Promise<RedisCommandExecResult> {
    return bridgeInvoke<RedisCommandExecResult>('redis.command.exec', params)
  },

  /** 命令名/参数自动补全；传入 `sessionId` 时优先对齐已连接服务器的真实命令集。 */
  commandSuggest(params: RedisCommandSuggestParams): Promise<RedisCommandSuggestResult> {
    return bridgeInvoke<RedisCommandSuggestResult>('redis.command.suggest', params)
  },

  /** 采集 `INFO` 派生的服务器指标（内存/客户端/复制/命中率等），短窗口内服务端有缓存。 */
  monitorMetrics(params: RedisMonitorMetricsParams): Promise<RedisMonitorMetricsResult> {
    return bridgeInvoke<RedisMonitorMetricsResult>('redis.monitor.metrics', params)
  },

  monitorSlowlog(params: RedisMonitorSlowlogParams): Promise<RedisMonitorSlowlogResult> {
    return bridgeInvoke<RedisMonitorSlowlogResult>('redis.monitor.slowlog', params)
  },

  /** 打开一条实时 `MONITOR` 命令流；后续数据通过 `redis.monitor.line` 事件推送。 */
  monitorStreamStart(params: RedisMonitorStreamStartParams): Promise<RedisMonitorStreamStartResult> {
    return bridgeInvoke<RedisMonitorStreamStartResult>('redis.monitor.stream.start', params)
  },

  monitorStreamStop(params: RedisMonitorStreamStopParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('redis.monitor.stream.stop', params)
  },

  /** 增量遍历 key 空间（`SCAN`），并附带每个 key 的类型/剩余存活时间/近似大小。 */
  keyspaceScan(params: RedisKeyspaceScanParams): Promise<RedisKeyspaceScanResult> {
    return bridgeInvoke<RedisKeyspaceScanResult>('redis.keyspace.scan', params)
  },
} as const
