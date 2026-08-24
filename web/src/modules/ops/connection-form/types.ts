import type { ConnectionProfileInput, CredentialInput } from '@/api/types/connection'
import type { FtpSessionTestParams } from '@/api/types/ftp'
import type { MongoSessionTestParams } from '@/api/types/mongodb'
import type { RedisSessionTestParams } from '@/api/types/redis'
import type { SshAuthType, SshSessionTestParams } from '@/api/types/ssh'
import type { VastSessionTestParams } from '@/api/types/vastbase'
import type { MysqlSessionTestParams } from '@/api/types/mysql'
import type { SqliteSessionTestParams } from '@/api/types/sqlite'
import type { KingbaseSessionTestParams } from '@/api/types/kingbase'
import type { ClickHouseSessionTestParams } from '@/api/types/clickhouse'
import type { DamengSessionTestParams } from '@/api/types/dameng'
import type { OracleSessionTestParams } from '@/api/types/oracle'
import type { SqlServerSessionTestParams } from '@/api/types/sqlserver'
import type { PostgresSessionTestParams } from '@/api/types/postgres'
import type { ProxyFormState, TunnelFormState } from '@/modules/connection'
import type { ConnAccentColor, ConnItem } from '@/modules/ops/types'

/** 连接表单对话框模式。delete 模式不渲染表单，仅用于删除确认。 */
export type ConnectionDlgMode = 'create' | 'edit' | 'delete'

/**
 * 连接表单公共字段（各协议共用 + SSH 凭据区）。
 * 协议专属字段写入索引签名，新增协议不必再扩字面量列表。
 */
export interface ConnectionFormCommon extends ProxyFormState, TunnelFormState {
  profileName: string
  hostAddress: string
  portNumber: string
  loginAccount: string
  password: string
  sshAuthType: SshAuthType
  sshPrivateKey: string
  sshPrivateKeyPath: string
  sshPassphrase: string
  connectTimeoutSeconds: string
  accentColor: ConnAccentColor
}

/**
 * 运维连接表单状态 = 公共字段 + 协议扩展。
 *
 * 扩展字段以字符串键挂在同一 reactive 对象上，便于 `v-model="form.redisDatabase"`；
 * 新增协议只写 defaults/adapter，不必再改本类型的字面量列表。
 * 索引用 `any` 以兼容 Vue v-model；adapter 读取扩展字段仍推荐 `formStr`。
 */
export type ConnectionFormState = ConnectionFormCommon & {
  // 协议扩展字段（运行时由 adapter.defaults 注入）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/** 读取字符串扩展字段（RsInput / RsSelect 绑定）。 */
export function formStr(form: ConnectionFormState, key: string, fallback = ''): string {
  const v = form[key]
  return typeof v === 'string' ? v : fallback
}

/** 写入扩展字段。 */
export function setFormField(form: ConnectionFormState, key: string, value: unknown): void {
  form[key] = value
}

/** 所有内置连接测试参数的联合类型；新增协议时可在这里扩展联合。 */
export type ConnectionTestParams =
  | FtpSessionTestParams
  | SshSessionTestParams
  | RedisSessionTestParams
  | MongoSessionTestParams
  | VastSessionTestParams
  | MysqlSessionTestParams
  | SqliteSessionTestParams
  | ClickHouseSessionTestParams
  | KingbaseSessionTestParams
  | DamengSessionTestParams
  | OracleSessionTestParams
  | SqlServerSessionTestParams
  | PostgresSessionTestParams

/** adapter 构造 connection_options 时可使用的通用上下文。 */
export interface ConnectionFormAdapterBuildContext {
  form: ConnectionFormState
  accent: Pick<NonNullable<ConnectionProfileInput['connectionOptions']>, 'accentColor'>
  proxy: NonNullable<ConnectionProfileInput['connectionOptions']>['proxy']
  tunnel: NonNullable<ConnectionProfileInput['connectionOptions']>['tunnel']
}

export interface ConnectionFormAdapterValidateContext {
  form: ConnectionFormState
  mode: ConnectionDlgMode
  t: (key: string) => string
  secret: string
}

export interface ConnectionFormAdapterTestContext {
  input: ConnectionProfileInput
  timeoutSeconds: number
}

export interface ConnectionFormAdapterSecretContext {
  form: ConnectionFormState
}

/**
 * 单个连接协议的表单适配器。
 *
 * `defaults()` 应返回协议扩展字段（如 redisDatabase）；公共字段由壳层初始化。
 */
export interface ConnectionFormAdapter {
  defaults: () => Record<string, unknown>
  applyProfile?: (form: ConnectionFormState, profile: ConnItem) => void
  buildOptions: (ctx: ConnectionFormAdapterBuildContext) => ConnectionProfileInput['connectionOptions']
  buildTestParams: (ctx: ConnectionFormAdapterTestContext) => ConnectionTestParams
  callSessionTest: (
    params: ConnectionTestParams,
  ) => Promise<{ ok: boolean; message: string; version?: string }>
  secret?: (ctx: ConnectionFormAdapterSecretContext) => string
  secretRequired?: (ctx: ConnectionFormAdapterSecretContext) => boolean
  credentialKind?: (ctx: ConnectionFormAdapterSecretContext) => CredentialInput['kind']
  authRequiredMessage?: (form: ConnectionFormState, t: (key: string) => string) => string
  validate?: (ctx: ConnectionFormAdapterValidateContext) => string | null
  applyLoadedSecret?: (form: ConnectionFormState, secret: string) => void
  /**
   * 协议专属测试结果文案增强（如缺客户端库引导、成功时附带版本）。
   * ops 壳层只调用；禁止在 useConnectionProfiles 内 import 具体协议模块。
   */
  enrichTestMessage?: (
    message: string,
    ok: boolean,
    t: (key: string, values?: Record<string, unknown>) => string,
    result?: { ok: boolean; message: string; version?: string },
  ) => string
}
