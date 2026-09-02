/** api-service 套接字会话（docs/36-api-module.md）。 */

export type ApiSocketKind = 'tcp-client' | 'tcp-server' | 'udp'

export type ApiSocketEncoding = 'auto' | 'utf8' | 'hex' | 'base64'

export type ApiSocketState = 'connected' | 'listening' | 'accepted' | 'closed' | 'lost'

export interface ApiSocketOpenParams {
  kind: ApiSocketKind
  host?: string
  port?: number
  localHost?: string
  localPort?: number
  timeoutMs?: number
  encoding?: ApiSocketEncoding
  readLimit?: number
}

export interface ApiSocketSessionInfo {
  sessionId: string
  kind: ApiSocketKind
  state: string
  host?: string
  port?: number
  localAddr?: string
  remoteAddr?: string
  encoding: string
  openedAt: string
  peerCount: number
}

export interface ApiSocketCloseParams {
  sessionId: string
}

export interface ApiSocketCloseResult {
  closed: boolean
}

export interface ApiSocketTestResult {
  ok: boolean
  message: string
}

export interface ApiSocketSendParams {
  sessionId: string
  data: string
  encoding?: ApiSocketEncoding
  peerId?: string
  host?: string
  port?: number
}

export interface ApiSocketSendResult {
  bytesSent: number
  at: string
  peerId?: string
  remoteAddr?: string
}

export interface ApiSocketListResult {
  sessions: ApiSocketSessionInfo[]
}

export interface ApiSocketPeersParams {
  sessionId: string
}

export interface ApiSocketPeerInfo {
  peerId: string
  remoteAddr: string
  localAddr?: string
  connectedAt: string
}

export interface ApiSocketPeersResult {
  peers: ApiSocketPeerInfo[]
}

export interface ApiSocketKickParams {
  sessionId: string
  peerId: string
}

export interface ApiSocketKickResult {
  kicked: boolean
}

export interface ApiSocketDataEvent {
  type: 'api.socket.data'
  sessionId: string
  direction: 'in' | 'out'
  remoteAddr?: string
  localAddr?: string
  encoding?: string
  data?: string
  hex?: string
  bytes?: number
  at?: string
  peerId?: string
}

export interface ApiSocketStateEvent {
  type: 'api.session.state'
  sessionId: string
  state: ApiSocketState | string
  peerId?: string
  remoteAddr?: string
  message?: string
}
