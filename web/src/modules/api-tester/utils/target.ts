import type { ApiMethod } from '../types'

export type SocketTransport = 'tcp-client' | 'tcp-server' | 'udp'

/** 工作台一条发送解析出的对端。HTTP 也走 TCP。 */
export interface SocketTarget {
  transport: SocketTransport
  protocol: string
  host: string
  port: number
  path: string
  http: boolean
  /** 通配地址或 listen:// 时绑定本机，会话保持到关标签。 */
  listen: boolean
}

export function isSocketMethod(method: ApiMethod): boolean {
  return method === 'TCP' || method === 'UDP'
}

export function isListenHost(host: string): boolean {
  const text = host.trim().toLowerCase()
  return text === '0.0.0.0' || text === '::' || text === '*' || text === '[::]'
}

export type TargetErrorCode = 'bad-url' | 'https' | 'ws'

export class TargetError extends Error {
  readonly code: TargetErrorCode

  constructor(code: TargetErrorCode, message: string) {
    super(message)
    this.name = 'TargetError'
    this.code = code
  }
}

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//

/** 从地址栏解析 host/port；TCP/UDP 为原始套接字，其余方法按明文 HTTP。 */
export function parseTarget(raw: string, method: ApiMethod): SocketTarget {
  const text = raw.trim()
  if (!text) {
    throw new TargetError('bad-url', 'empty url')
  }
  if (method === 'WS') {
    throw new TargetError('ws', 'websocket not supported')
  }
  if (method === 'TCP' || method === 'UDP') {
    const scheme = SCHEME.exec(text)?.[1]?.toLowerCase()
    const proto = method === 'UDP' || scheme === 'udp' ? 'udp' : 'tcp'
    return parseHostPort(stripScheme(text), proto, scheme === 'listen')
  }
  return parseHttpTarget(text)
}

function parseHttpTarget(text: string): SocketTarget {
  let urlText = text
  if (!SCHEME.test(urlText)) {
    urlText = `http://${urlText}`
  }
  let parsed: URL
  try {
    parsed = new URL(urlText)
  } catch {
    throw new TargetError('bad-url', 'invalid url')
  }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
  if (scheme === 'https') {
    throw new TargetError('https', 'https not supported')
  }
  if (scheme === 'ws' || scheme === 'wss') {
    throw new TargetError('ws', 'websocket not supported')
  }
  if (scheme === 'tcp' || scheme === 'udp' || scheme === 'listen') {
    return parseHostPort(stripScheme(text), scheme === 'udp' ? 'udp' : 'tcp', scheme === 'listen')
  }
  if (scheme !== 'http') {
    throw new TargetError('bad-url', `unsupported scheme ${scheme}`)
  }
  const port = parsed.port ? Number(parsed.port) : 80
  if (!parsed.hostname || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new TargetError('bad-url', 'invalid host or port')
  }
  const path = `${parsed.pathname || '/'}${parsed.search}`
  return {
    transport: 'tcp-client',
    protocol: 'HTTP/1.1',
    host: parsed.hostname,
    port,
    path,
    http: true,
    listen: false,
  }
}

function parseHostPort(text: string, proto: 'tcp' | 'udp', forceListen = false): SocketTarget {
  let hostPort = text
  const slash = hostPort.search(/[/?#]/)
  if (slash >= 0) {
    hostPort = hostPort.slice(0, slash)
  }
  const v6 = /^\[([^\]]+)\]:(\d+)$/.exec(hostPort)
  if (v6) {
    return socketTarget(v6[1]!, Number(v6[2]), proto, forceListen)
  }
  const colon = hostPort.lastIndexOf(':')
  if (colon < 0) {
    throw new TargetError('bad-url', 'host:port required')
  }
  const host = hostPort.slice(0, colon).replace(/^\[|\]$/g, '')
  const port = Number(hostPort.slice(colon + 1))
  return socketTarget(host, port, proto, forceListen)
}

function socketTarget(host: string, port: number, proto: 'tcp' | 'udp', forceListen = false): SocketTarget {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new TargetError('bad-url', 'invalid host or port')
  }
  const trimmed = host.trim()
  const listen = forceListen || isListenHost(trimmed) || !trimmed
  const resolved = !trimmed || trimmed === '*' ? '0.0.0.0' : trimmed
  return {
    transport: proto === 'udp' ? 'udp' : listen ? 'tcp-server' : 'tcp-client',
    protocol: proto.toUpperCase(),
    host: resolved,
    port,
    path: '',
    http: false,
    listen,
  }
}

function stripScheme(text: string): string {
  return text.replace(SCHEME, '')
}

/** 把 `host:port` / `[v6]:port` 拆成发送目的；通配地址不算对端。 */
export function parseRemoteAddr(addr: string | undefined): { host: string; port: number } | null {
  const text = addr?.trim()
  if (!text) return null
  try {
    const target = parseTarget(text, 'UDP')
    if (isListenHost(target.host)) return null
    return { host: target.host, port: target.port }
  } catch {
    return null
  }
}

/** UDP 监听绑定走 localHost/localPort，避免把 0.0.0.0 或 listen:// 网卡地址当成发送目的。 */
export function socketOpenFields(target: SocketTarget): {
  host?: string
  port?: number
  localHost?: string
  localPort?: number
} {
  if (target.transport === 'udp' && target.listen) {
    return { localHost: target.host, localPort: target.port }
  }
  return { host: target.host, port: target.port }
}

/** UDP 服务端回包寄最近（或点选的）对端；客户端寄地址栏。 */
export function resolveSocketSendDest(
  target: SocketTarget,
  peerAddr?: string,
): { host: string; port: number } | undefined {
  if (target.transport === 'udp' && target.listen) {
    return parseRemoteAddr(peerAddr) ?? undefined
  }
  return { host: target.host, port: target.port }
}
