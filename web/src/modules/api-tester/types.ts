/** HTTP / 原始协议方法。发送走 api-service：TCP/UDP 原帧，明文 HTTP 经 TCP。 */
export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'WS' | 'TCP' | 'UDP'

/** 键值行（Query / Header）。 */
export interface ApiKvRow {
  id: string
  enabled: boolean
  key: string
  value: string
}

/** 集合中的一条可编辑请求。 */
export interface ApiRequest {
  id: string
  name: string
  method: ApiMethod
  url: string
  params: ApiKvRow[]
  headers: ApiKvRow[]
  body: string
}

/** 集合文件夹。 */
export interface ApiFolder {
  id: string
  name: string
  requests: ApiRequest[]
}

/** 环境：只解析 {{baseUrl}}，不进全局连接树。 */
export interface ApiEnvironment {
  id: string
  name: string
  baseUrl: string
}

/** 侧栏历史一条：解析后的发送快照。 */
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

export type ApiSideView = 'collection' | 'history'

export type ApiResponseView = 'pretty' | 'raw' | 'headers' | 'hex'

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
}
