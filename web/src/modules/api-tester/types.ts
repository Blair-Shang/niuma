import type { ApiVariableKind } from '@/api/types/api-catalog'
import type { ApiVariableScope } from './utils/folder-tree'

export type { ApiVariableKind }

/** HTTP / 原始协议方法。发送走 api-service：TCP/UDP 原帧，明文 HTTP 经 TCP。 */
export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'WS' | 'TCP' | 'UDP'

/** 键值行（Query / Header / Form）。 */
export interface ApiKvRow {
  id: string
  enabled: boolean
  key: string
  value: string
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

export type ApiAuthType = 'none' | 'bearer' | 'basic' | 'apikey'

/** 结构化 Authorization；发送前写入 Header / Query。 */
export interface ApiAuth {
  type: ApiAuthType
  bearer?: { token: string }
  basic?: { username: string; password: string }
  apiKey?: { key: string; value: string; in: 'header' | 'query' }
}

export type ApiBodyMode = 'none' | 'raw' | 'json' | 'text' | 'urlencoded' | 'form'

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
  kind: 'tcp-client' | 'tcp-server' | 'udp'
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
  error?: string
  meta?: { runId?: string; iteration?: number; workerId?: number }
}
