import { redisApi } from '@/api'
import type { RedisConnectionOptions, RedisSessionTestParams, RedisTopology } from '@/api/types/redis'
import { DEFAULT_REDIS_OPTIONS } from '@/api/types/redis'
import {
  applyStoredTimeout,
  basePasswordSecret,
  buildTimeoutSeconds,
  parseRedisNodesText,
  passwordCredentialKind,
} from '@/modules/ops/connection-form/adapter-helpers'
import {
  formStr,
  type ConnectionFormAdapter,
  type ConnectionTestParams,
} from '@/modules/ops/connection-form/types'
import {
  cappedTestTimeout,
  readStoredSentinelMasterName,
  readStoredTimeoutSeconds,
} from '@/modules/connection/connection-options'

export const redisConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    redisDatabase: String(DEFAULT_REDIS_OPTIONS.database),
    redisTopology: DEFAULT_REDIS_OPTIONS.topology,
    redisSentinelMasterName: '',
    redisNodes: '',
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as RedisConnectionOptions | undefined
    const raw = opts as Record<string, unknown> | undefined
    form.redisDatabase = String(opts?.database ?? DEFAULT_REDIS_OPTIONS.database)
    form.redisTopology = opts?.topology ?? DEFAULT_REDIS_OPTIONS.topology
    form.redisSentinelMasterName = readStoredSentinelMasterName(raw)
    form.redisNodes = Array.isArray(opts?.nodes) ? opts.nodes.join('\n') : ''
    applyStoredTimeout(form, raw, DEFAULT_REDIS_OPTIONS.timeout_seconds)
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    return {
      ...DEFAULT_REDIS_OPTIONS,
      ...accent,
      database: Number.parseInt(formStr(form, 'redisDatabase', '0'), 10) || 0,
      topology: formStr(form, 'redisTopology', DEFAULT_REDIS_OPTIONS.topology) as RedisTopology,
      timeout_seconds: buildTimeoutSeconds(form, DEFAULT_REDIS_OPTIONS.timeout_seconds),
      sentinel_master_name: formStr(form, 'redisSentinelMasterName').trim(),
      nodes: parseRedisNodesText(formStr(form, 'redisNodes')),
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as RedisConnectionOptions
    const raw = opts as unknown as Record<string, unknown>
    return {
      hostAddress: input.hostAddress,
      portNumber: input.portNumber,
      loginAccount: input.loginAccount,
      options: {
        ...opts,
        timeout_seconds: cappedTestTimeout(
          readStoredTimeoutSeconds(raw, DEFAULT_REDIS_OPTIONS.timeout_seconds),
          DEFAULT_REDIS_OPTIONS.timeout_seconds,
          timeoutSeconds,
        ),
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return redisApi.sessionTest(params as RedisSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => false,
  credentialKind: passwordCredentialKind,
}
