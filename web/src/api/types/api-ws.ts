/** api.ws.connect / send / close。事件仍走 api.socket.data。 */

export interface ApiWsHeader {
  name: string
  value: string
}

export interface ApiWsConnectParams {
  url: string
  headers?: ApiWsHeader[]
  protocols?: string[]
  insecure?: boolean
  proxy?: string
  certPath?: string
  keyPath?: string
  timeoutMs?: number
}

export interface ApiWsSessionInfo {
  sessionId: string
  state: string
  url: string
  localAddr?: string
  remoteAddr?: string
}

export interface ApiWsSendParams {
  sessionId: string
  data: string
  encoding?: 'utf8' | 'base64' | 'hex'
}

export interface ApiWsSendResult {
  bytesSent: number
}

export interface ApiWsCloseParams {
  sessionId: string
}

export interface ApiWsCloseResult {
  closed: boolean
}
