import type { ApiVariableKind } from '@/api/types/api-catalog'
import type { ApiVariableScope } from './utils/folder-tree'

export type { ApiVariableKind }

/** HTTP / 原始协议方法。发送走 api-service：TCP/UDP 原帧，明文 HTTP 经 TCP。 */
export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'WS' | 'TCP' | 'UDP' | 'GRPC'

/** 键值行（Query / Header / Form）。 */
export interface ApiKvRow {
  id: string
  enabled: boolean
  key: string
  value: string
  /** 表单文件的本机路径。有值时按文件上传，不再把 value 当文本字段。 */
  filePath?: string
}

/** 带类型的变量行；kind 落 nm_api_variable，插值仍用 value 字符串。 */
export interface ApiVarRow extends ApiKvRow {
  kind: ApiVariableKind
}

/** 变量包：globals / 文件夹 / 环境。kinds 与 vars 同 key。 */
export interface ApiVariableBag {
  vars: Record<string, string>
  kinds?: Record<string, ApiVariableKind>
}

export type ApiAuthType = 'none' | 'bearer' | 'basic' | 'apikey' | 'oauth2' | 'digest' | 'awsv4' | 'ntlm'

/** Digest 用户名和密码。口令在收到 401 后参与计算。 */
export interface ApiDigestAuth {
  username: string
  password: string
}

/** AWS Signature V4。签名只在发送时计算。 */
export interface ApiAwsAuth {
  accessKey: string
  secretKey: string
  region: string
  service: string
  sessionToken: string
}

/** NTLM。三次握手由 api-service 在同一连接上完成。 */
export interface ApiNtlmAuth {
  username: string
  password: string
  domain: string
}

export type OAuthGrant = 'client_credentials' | 'password' | 'authorization_code'

/** OAuth 2.0。令牌由「获取令牌」或发送前自动刷新写入。 */
export interface ApiOAuth2 {
  grant: OAuthGrant
  /** body：客户端信息放进表单；basic：用 Authorization Basic。 */
  clientAuth: 'body' | 'basic'
  accessTokenUrl: string
  authUrl: string
  callbackUrl: string
  clientId: string
  clientSecret: string
  scope: string
  username: string
  password: string
  accessToken: string
  refreshToken: string
  /** 过期时间，毫秒时间戳。0 表示未知。 */
  expiresAt: number
  codeVerifier: string
}

/** 结构化 Authorization；发送前写入 Header / Query。 */
export interface ApiAuth {
  type: ApiAuthType
  bearer?: { token: string }
  basic?: { username: string; password: string }
  apiKey?: { key: string; value: string; in: 'header' | 'query' }
  oauth2?: ApiOAuth2
  digest?: ApiDigestAuth
  awsv4?: ApiAwsAuth
  ntlm?: ApiNtlmAuth
}

export type ApiBodyMode = 'none' | 'raw' | 'json' | 'text' | 'urlencoded' | 'form' | 'graphql'

/** GraphQL 正文。发送时编成 `{ query, variables }` JSON。 */
export interface ApiGraphQLBody {
  query: string
  variables: string
}

/** 单条请求的传输设置。证书校验仍用 insecureTLS，避免和地址栏开关拆成两处。 */
export interface ApiHttpSettings {
  /** 毫秒。0 或非法值按 30 秒。 */
  timeoutMs: number
  /** 空字符串走系统代理。仅 http / https 代理。 */
  proxy: string
  certPath: string
  keyPath: string
}

/** 集合中的一条可编辑请求。 */
export interface ApiRequest {
  id: string
  name: string
  method: ApiMethod
  url: string
  params: ApiKvRow[]
  headers: ApiKvRow[]
  auth: ApiAuth
  bodyMode: ApiBodyMode
  body: string
  bodyForm?: ApiKvRow[]
  graphql?: ApiGraphQLBody
  /** 为 true 时跳过 TLS 证书校验，用于自签名证书。 */
  insecureTLS?: boolean
  settings?: ApiHttpSettings
  /** WebSocket 子协议，逗号分隔。 */
  wsProtocols?: string
  /** 发送前写入环境或全局变量。 */
  preSteps?: ApiPreStep[]
  /** 响应断言。失败时本次交换记为不通过。 */
  checks?: ApiCheck[]
  /** Postman 风格发送前脚本。 */
  preRequestScript?: string
  /** Postman 风格测试脚本。 */
  testScript?: string
  /** gRPC 全方法名，例如 helloworld.Greeter/SayHello。 */
  grpcMethod?: string
}

export type ApiCheckKind = 'status' | 'bodyContains' | 'header' | 'jsonEquals' | 'timeUnder'

/** 一条断言。target 是响应头名或 JSON 路径，expect 是期望值。 */
export interface ApiCheck {
  id: string
  enabled: boolean
  kind: ApiCheckKind
  target: string
  expect: string
}

/** 发送前赋值。value 支持 {{var}}。 */
export interface ApiPreStep {
  id: string
  enabled: boolean
  scope: 'global' | 'environment'
  key: string
  value: string
}

export interface ApiCheckResult {
  ok: boolean
  kind: ApiCheckKind
  detail: string
}

/** 集合文件夹。 */
export interface ApiFolder {
  id: string
  name: string
  parentId: string | null
  vars: Record<string, string>
  kinds?: Record<string, ApiVariableKind>
  requests: ApiRequest[]
}

/** 环境：解析 {{var}}，不进全局连接树。 */
export interface ApiEnvironment {
  id: string
  name: string
  baseUrl: string
  vars: Record<string, string>
  kinds?: Record<string, ApiVariableKind>
}

/** 压测配置槽（P1 默认 []，见 docs/38-api-run.md）。 */
export interface ApiRunProfile {
  id: string
  name: string
  kind: 'collection' | 'folder' | 'request'
  targetIds: string[]
  concurrency: number
  iterations: number
  rampUpMs?: number
  thinkTimeMs?: number
  envId?: string
  enabled: boolean
}

/** Mock 路由（P1 默认 []，见 docs/39-api-mock.md）。 */
export interface ApiMockRoute {
  id: string
  name: string
  method: ApiMethod
  path: string
  match: 'exact' | 'prefix' | 'param'
  status: number
  statusText?: string
  headers: ApiKvRow[]
  body: string
  bodyMode?: ApiBodyMode
  delayMs?: number
  sourceRequestId?: string
  /** 非空时替换正文。支持 {{req.method}}、{{req.path}}、{{req.query.x}}、{{req.header.Name}}、{{req.body}}，首行 @status 可改状态码。 */
  script?: string
}

export interface ApiMockServer {
  id: string
  name: string
  enabled: boolean
  host: string
  port: number
  routes: ApiMockRoute[]
}


/** 发送选项；Runner / 压测与 UI 共用 execute 入口。 */
export interface ApiSendOptions {
  mode?: 'interactive' | 'batch'
  envId?: string
  signal?: AbortSignal
  skipHistory?: boolean
  meta?: { runId?: string; iteration?: number; workerId?: number }
  scope?: ApiVariableScope
  /** 数据文件当前行，覆盖同名环境变量，不写回环境。 */
  data?: Record<string, string>
}

/** 侧栏历史一条：默认只有摘要；request/exchange 仅离线或打开后才有。 */
export interface ApiHistoryItem {
  historyId: string
  requestId: string
  requestName: string
  method: ApiMethod
  url: string
  environmentName: string
  request: ApiRequest | null
  exchange: ApiExchange | null
  durationMs: number
  httpStatus: number | null
  createdAt: string
}

export type ApiResponseView = 'pretty' | 'raw' | 'headers' | 'hex'

/** TCP 监听下仍连着的一个客户端。 */
export interface ApiLivePeer {
  peerId: string
  remoteAddr: string
}

/** 某请求页签上仍开着的 TCP / UDP 会话。 */
export interface ApiLiveSocket {
  requestId: string
  sessionId: string
  kind: 'tcp-client' | 'tcp-server' | 'udp' | 'websocket'
  host: string
  port: number
  state: string
  localAddr?: string
  remoteAddr?: string
  /** 仅 tcp-server：当前已接入的连接，断开即移除。 */
  peers?: ApiLivePeer[]
  startedAt: number
}

/** 一次发送后的展示结果（含传输失败）。 */
export interface ApiExchange {
  ok: boolean
  status: number | null
  statusText: string
  durationMs: number
  sizeBytes: number
  protocol: string
  headers: ApiKvRow[]
  body: string
  /** L1 上报的十六进制，二进制响应优先用这个画 Hex 视图。 */
  hex?: string
  /** 正文不是文本。 */
  binary?: boolean
  /** 跟随重定向时经过的跳转。 */
  redirects?: { status: number; url: string }[]
  error?: string
  /** 本次响应的断言结果。 */
  checks?: ApiCheckResult[]
  meta?: { runId?: string; iteration?: number; workerId?: number }
}
