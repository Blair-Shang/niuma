import type { ConnectionProfileInput, CredentialInput } from '@/api/types/connection'
import type { FtpSessionTestParams } from '@/api/types/ftp'
import type { MongoSessionTestParams } from '@/api/types/mongodb'
import type { RedisSessionTestParams, RedisTopology } from '@/api/types/redis'
import type { SshAuthType, SshSessionTestParams } from '@/api/types/ssh'
import type { ProxyFormState, TunnelFormState } from '@/modules/connection'
import type { ConnAccentColor, ConnItem } from '@/modules/ops/types'

/** 连接表单对话框模式。delete 模式不渲染表单，仅用于删除确认。 */
export type ConnectionDlgMode = 'create' | 'edit' | 'delete'

/**
 * 运维连接表单的统一状态对象。
 *
 * 这里保留一个扁平结构，是为了让通用表单、协议组件、代理组件、隧道组件都能通过
 * 同一个 reactive form 读写。协议专属字段由对应 ConnectionFormAdapter 决定如何解释，
 * 不应在 useConnectionProfiles 里继续写 connection kind 分支。
 */
export interface ConnectionFormState extends ProxyFormState, TunnelFormState {
  /** 站点显示名。 */
  profileName: string
  /** 目标主机或 IP。 */
  hostAddress: string
  /** 字符串端口，便于与输入框直接绑定。 */
  portNumber: string
  /** 登录账号；Redis 等协议可为空。 */
  loginAccount: string
  /** 默认密码字段；SSH 私钥内容不放这里，而是放 sshPrivateKey。 */
  password: string
  /** SSH 认证方式。非 SSH 协议忽略该字段。 */
  sshAuthType: SshAuthType
  /** SSH 私钥内容，保存时作为 ssh_private_key 凭据写入 Keychain。 */
  sshPrivateKey: string
  /** SSH 私钥文件路径，仅保存路径，不保存文件内容。 */
  sshPrivateKeyPath: string
  /** SSH 私钥 passphrase，随 SSH options 保存。 */
  sshPassphrase: string
  /**
   * 建连超时（秒），各协议共用；留空使用协议默认值。
   * 持久化为 connection_options.timeout_seconds。
   */
  connectTimeoutSeconds: string
  /** 连接树标签色。 */
  accentColor: ConnAccentColor
  /** FTP 协议类型。 */
  protocol: 'ftp' | 'ftps'
  /** FTPS TLS 握手模式。'explicit' = AUTH TLS（默认端口 21），'implicit' = 直接 TLS（默认端口 990）。 */
  ftpTlsMode: 'explicit' | 'implicit'
  /** FTPS 是否验证服务端 TLS 证书；字符串化便于 RsSelect 绑定，'false' 可用于自签名证书。 */
  ftpTlsVerify: string
  /** FTP 被动模式，字符串化便于 RsSelect 绑定。 */
  passive: string
  /** FTP 文件名编码。 */
  encoding: 'utf-8' | 'gbk'
  /** Redis 逻辑库编号，字符串化便于输入框绑定。 */
  redisDatabase: string
  /** Redis 部署拓扑。 */
  redisTopology: RedisTopology
  /** Redis sentinel 主节点名称。 */
  redisSentinelMasterName: string
  /** Redis 额外种子节点原始文本，保存时由 adapter 解析。 */
  redisNodes: string
  /** MongoDB 部署拓扑。 */
  mongoTopology: import('@/api/types/mongodb').MongoTopology
  mongoAuthMechanism: import('@/api/types/mongodb').MongoAuthMechanism
  mongoAuthDatabase: string
  mongoReplicaSet: string
  mongoReadPreference: import('@/api/types/mongodb').MongoReadPreference
  /** SRV 记录开关，字符串化便于 RsSelect 绑定。 */
  mongoSrvRecord: string
  mongoClientDriver: import('@/api/types/mongodb').MongoClientDriver
  mongoDefaultDatabase: string
}

/** 所有内置连接测试参数的联合类型；新增协议时可在这里扩展联合。 */
export type ConnectionTestParams =
  | FtpSessionTestParams
  | SshSessionTestParams
  | RedisSessionTestParams
  | MongoSessionTestParams

/** adapter 构造 connection_options 时可使用的通用上下文。 */
export interface ConnectionFormAdapterBuildContext {
  form: ConnectionFormState
  /** 通用标签色 options 片段。 */
  accent: Pick<NonNullable<ConnectionProfileInput['connectionOptions']>, 'accentColor'>
  /** 已由公共 proxy-form 构造好的代理配置。 */
  proxy: NonNullable<ConnectionProfileInput['connectionOptions']>['proxy']
  /** 已由公共 tunnel-form 构造好的隧道配置。 */
  tunnel: NonNullable<ConnectionProfileInput['connectionOptions']>['tunnel']
}

/** adapter 执行协议专属校验时可使用的上下文。 */
export interface ConnectionFormAdapterValidateContext {
  form: ConnectionFormState
  mode: ConnectionDlgMode
  /** i18n 翻译函数，adapter 返回可直接展示的错误文本。 */
  t: (key: string) => string
  /** 当前协议从表单中解析出的敏感凭据。 */
  secret: string
}

/** adapter 构造 session.test 参数时可使用的上下文。 */
export interface ConnectionFormAdapterTestContext {
  /** 已构造好的 profile input，包含 adapter 自己生成的 connectionOptions。 */
  input: ConnectionProfileInput
  /** 测试连接使用较短超时上限，避免用户长时间等待；实际值见各 adapter 的 cappedTestTimeout。 */
  timeoutSeconds: number
}

/** adapter 读取凭据字段时可使用的上下文。 */
export interface ConnectionFormAdapterSecretContext {
  form: ConnectionFormState
}

/**
 * 单个连接协议的表单适配器。
 *
 * 通用 composable 只调用这些钩子，不关心 FTP/Redis/SSH 的字段细节。新增协议时，
 * 在 builtin-adapters.ts 或协议自己的模块中实现 adapter，并在 connection-kinds.ts 注册。
 */
export interface ConnectionFormAdapter {
  /** 返回该协议的默认表单字段，会覆盖通用默认值。 */
  defaults: () => Partial<ConnectionFormState>
  /** 编辑已有 profile 时，把 connectionOptions 回填到表单。 */
  applyProfile?: (form: ConnectionFormState, profile: ConnItem) => void
  /** 从表单构造 connection_options。 */
  buildOptions: (ctx: ConnectionFormAdapterBuildContext) => ConnectionProfileInput['connectionOptions']
  /** 从 profile input 构造 session.test 参数。 */
  buildTestParams: (ctx: ConnectionFormAdapterTestContext) => ConnectionTestParams
  /** 调用该协议自己的 session.test API。 */
  callSessionTest: (params: ConnectionTestParams) => Promise<{ ok: boolean; message: string }>
  /** 从表单中提取要写入 Keychain 的敏感凭据；为空表示不写。 */
  secret?: (ctx: ConnectionFormAdapterSecretContext) => string
  /** 当前模式下是否要求新建时必须提供凭据。 */
  secretRequired?: (ctx: ConnectionFormAdapterSecretContext) => boolean
  /** Keychain 凭据类型，例如 password 或 ssh_private_key。 */
  credentialKind?: (ctx: ConnectionFormAdapterSecretContext) => CredentialInput['kind']
  /** 凭据缺失时展示的错误信息。 */
  authRequiredMessage?: (form: ConnectionFormState, t: (key: string) => string) => string
  /** 协议专属校验；返回 null 表示通过，返回字符串表示错误信息。 */
  validate?: (ctx: ConnectionFormAdapterValidateContext) => string | null
  /** 从 Keychain 读取明文凭据后回填到协议对应字段。 */
  applyLoadedSecret?: (form: ConnectionFormState, secret: string) => void
}
