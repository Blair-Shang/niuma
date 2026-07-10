import { ftpApi, mongodbApi, redisApi, sshApi } from '@/api'
import type { CredentialInput } from '@/api/types/connection'
import type { FtpConnectionOptions, FtpSessionTestParams } from '@/api/types/ftp'
import { DEFAULT_FTP_OPTIONS } from '@/api/types/ftp'
import type { MongoConnectionOptions, MongoSessionTestParams } from '@/api/types/mongodb'
import { DEFAULT_MONGO_OPTIONS } from '@/api/types/mongodb'
import type { RedisConnectionOptions, RedisSessionTestParams } from '@/api/types/redis'
import { DEFAULT_REDIS_OPTIONS } from '@/api/types/redis'
import type { SshConnectionOptions, SshSessionTestParams } from '@/api/types/ssh'
import { DEFAULT_SSH_OPTIONS } from '@/api/types/ssh'
import {
  cappedTestTimeout,
  formatTimeoutFormValue,
  parseTimeoutFormValue,
  readStoredSentinelMasterName,
  readStoredTimeoutSeconds,
} from '@/modules/connection'
import type { ConnectionFormAdapter, ConnectionFormState, ConnectionTestParams } from './types'

/** 将 Redis 节点输入框中的换行/逗号分隔文本解析为 host:port 数组。 */
function parseRedisNodesText(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function applyStoredTimeout(form: ConnectionFormState, options: Record<string, unknown> | undefined, defaultSeconds: number): void {
  const stored = readStoredTimeoutSeconds(options, defaultSeconds)
  form.connectTimeoutSeconds = formatTimeoutFormValue(stored, defaultSeconds)
}

function buildTimeoutSeconds(form: ConnectionFormState, defaultSeconds: number): number {
  return parseTimeoutFormValue(form.connectTimeoutSeconds, defaultSeconds)
}

/** 默认密码型协议直接使用通用 password 字段作为 Keychain secret。 */
function basePasswordSecret({ form }: { form: ConnectionFormState }): string {
  return form.password.trim()
}

/** 默认凭据类型为 password；SSH 私钥 adapter 会覆盖该行为。 */
function passwordCredentialKind(): CredentialInput['kind'] {
  return 'password'
}

/** 默认凭据缺失提示。 */
function passwordRequiredMessage(_form: ConnectionFormState, t: (key: string) => string): string {
  return t('opsNav.passwordRequired')
}

/** FTP / FTPS 连接表单 adapter。 */
export const ftpConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    protocol: 'ftp',
    ftpTlsMode: 'explicit',
    ftpTlsVerify: 'true',
    passive: 'true',
    encoding: 'utf-8',
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as FtpConnectionOptions | undefined
    form.protocol = opts?.protocol ?? 'ftp'
    form.ftpTlsMode = opts?.tls_mode === 'implicit' ? 'implicit' : 'explicit'
    form.ftpTlsVerify = String(opts?.tls_verify ?? true)
    form.passive = String(opts?.passive ?? true)
    form.encoding = opts?.encoding ?? 'utf-8'
    applyStoredTimeout(form, opts as Record<string, unknown> | undefined, DEFAULT_FTP_OPTIONS.timeout_seconds)
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    return {
      ...DEFAULT_FTP_OPTIONS,
      ...accent,
      protocol: form.protocol,
      tls_mode: form.protocol === 'ftps' ? form.ftpTlsMode : 'none',
      tls_verify: form.protocol === 'ftps' ? form.ftpTlsVerify !== 'false' : true,
      passive: form.passive === 'true',
      encoding: form.encoding,
      timeout_seconds: buildTimeoutSeconds(form, DEFAULT_FTP_OPTIONS.timeout_seconds),
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as FtpConnectionOptions
    return {
      hostAddress: input.hostAddress,
      portNumber: input.portNumber,
      loginAccount: input.loginAccount,
      options: {
        ...opts,
        timeout_seconds: cappedTestTimeout(
          readStoredTimeoutSeconds(opts as unknown as Record<string, unknown>, DEFAULT_FTP_OPTIONS.timeout_seconds),
          DEFAULT_FTP_OPTIONS.timeout_seconds,
          timeoutSeconds,
        ),
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return ftpApi.sessionTest(params as FtpSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => true,
  credentialKind: passwordCredentialKind,
  authRequiredMessage: passwordRequiredMessage,
}

/** Redis 连接表单 adapter；密码可选，拓扑/节点信息写入 connection_options。 */
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
      database: Number.parseInt(form.redisDatabase, 10) || 0,
      topology: form.redisTopology,
      timeout_seconds: buildTimeoutSeconds(form, DEFAULT_REDIS_OPTIONS.timeout_seconds),
      sentinel_master_name: form.redisSentinelMasterName.trim(),
      nodes: parseRedisNodesText(form.redisNodes),
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

/** MongoDB 连接表单 adapter。 */
export const mongodbConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    mongoTopology: DEFAULT_MONGO_OPTIONS.topology,
    mongoAuthMechanism: DEFAULT_MONGO_OPTIONS.auth_mechanism,
    mongoAuthDatabase: DEFAULT_MONGO_OPTIONS.auth_database,
    mongoReplicaSet: DEFAULT_MONGO_OPTIONS.replica_set,
    mongoReadPreference: DEFAULT_MONGO_OPTIONS.read_preference,
    mongoSrvRecord: 'false',
    mongoClientDriver: DEFAULT_MONGO_OPTIONS.client_driver,
    mongoDefaultDatabase: DEFAULT_MONGO_OPTIONS.default_database,
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as MongoConnectionOptions | undefined
    const raw = opts as Record<string, unknown> | undefined
    form.mongoTopology = opts?.topology ?? DEFAULT_MONGO_OPTIONS.topology
    form.mongoAuthMechanism = opts?.auth_mechanism ?? DEFAULT_MONGO_OPTIONS.auth_mechanism
    form.mongoAuthDatabase = opts?.auth_database ?? DEFAULT_MONGO_OPTIONS.auth_database
    form.mongoReplicaSet = opts?.replica_set ?? ''
    form.mongoReadPreference = opts?.read_preference ?? DEFAULT_MONGO_OPTIONS.read_preference
    form.mongoSrvRecord = String(opts?.srv_record ?? false)
    form.mongoClientDriver = opts?.client_driver ?? DEFAULT_MONGO_OPTIONS.client_driver
    form.mongoDefaultDatabase = opts?.default_database ?? ''
    applyStoredTimeout(form, raw, DEFAULT_MONGO_OPTIONS.timeout_seconds)
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    return {
      ...DEFAULT_MONGO_OPTIONS,
      ...accent,
      topology: form.mongoTopology,
      auth_mechanism: form.mongoAuthMechanism,
      auth_database: form.mongoAuthDatabase.trim() || DEFAULT_MONGO_OPTIONS.auth_database,
      replica_set: form.mongoReplicaSet.trim(),
      read_preference: form.mongoReadPreference,
      srv_record: form.mongoSrvRecord === 'true',
      client_driver: form.mongoClientDriver,
      default_database: form.mongoDefaultDatabase.trim(),
      timeout_seconds: buildTimeoutSeconds(form, DEFAULT_MONGO_OPTIONS.timeout_seconds),
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as MongoConnectionOptions
    const raw = opts as unknown as Record<string, unknown>
    return {
      hostAddress: input.hostAddress,
      portNumber: input.portNumber,
      loginAccount: input.loginAccount,
      options: {
        ...opts,
        timeout_seconds: cappedTestTimeout(
          readStoredTimeoutSeconds(raw, DEFAULT_MONGO_OPTIONS.timeout_seconds),
          DEFAULT_MONGO_OPTIONS.timeout_seconds,
          timeoutSeconds,
        ),
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return mongodbApi.sessionTest(params as MongoSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => false,
  credentialKind: passwordCredentialKind,
}

/** SSH 连接表单 adapter；负责密码、私钥内容、私钥文件三种认证方式。 */
export const sshConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    sshAuthType: DEFAULT_SSH_OPTIONS.auth_type,
    sshPrivateKey: '',
    sshPrivateKeyPath: '',
    sshPassphrase: '',
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as SshConnectionOptions | undefined
    form.sshAuthType = opts?.auth_type ?? DEFAULT_SSH_OPTIONS.auth_type
    form.sshPrivateKey = ''
    form.sshPrivateKeyPath = opts?.private_key_path ?? ''
    form.sshPassphrase = opts?.passphrase ?? ''
    applyStoredTimeout(form, opts as Record<string, unknown> | undefined, DEFAULT_SSH_OPTIONS.timeout_seconds)
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    return {
      ...DEFAULT_SSH_OPTIONS,
      ...accent,
      auth_type: form.sshAuthType,
      private_key_path: form.sshPrivateKeyPath.trim(),
      passphrase: form.sshPassphrase,
      timeout_seconds: buildTimeoutSeconds(form, DEFAULT_SSH_OPTIONS.timeout_seconds),
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as SshConnectionOptions
    return {
      hostAddress: input.hostAddress,
      portNumber: input.portNumber,
      loginAccount: input.loginAccount,
      options: {
        ...opts,
        timeout_seconds: cappedTestTimeout(
          readStoredTimeoutSeconds(opts as unknown as Record<string, unknown>, DEFAULT_SSH_OPTIONS.timeout_seconds),
          DEFAULT_SSH_OPTIONS.timeout_seconds,
          timeoutSeconds,
        ),
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return sshApi.sessionTest(params as SshSessionTestParams)
  },
  secret({ form }) {
    if (form.sshAuthType === 'private_key') {
      return form.sshPrivateKey.trim()
    }
    if (form.sshAuthType === 'password') {
      return form.password.trim()
    }
    return ''
  },
  secretRequired({ form }) {
    return form.sshAuthType !== 'private_key_file'
  },
  credentialKind({ form }) {
    return form.sshAuthType === 'private_key' ? 'ssh_private_key' : 'password'
  },
  authRequiredMessage(form, t) {
    if (form.sshAuthType === 'private_key') {
      return t('connection.form.privateKeyRequired')
    }
    if (form.sshAuthType === 'private_key_file') {
      return t('connection.form.privateKeyPathRequired')
    }
    return t('opsNav.passwordRequired')
  },
  validate({ form, t }) {
    if (form.sshAuthType === 'private_key_file' && !form.sshPrivateKeyPath.trim()) {
      return t('connection.form.privateKeyPathRequired')
    }
    return null
  },
  applyLoadedSecret(form, secret) {
    if (form.sshAuthType === 'private_key') {
      form.sshPrivateKey = secret
      return
    }
    form.password = secret
  },
}
