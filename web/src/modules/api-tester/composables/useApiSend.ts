import { apiSocketApi, isBridgeAvailable } from '@/api'
import type { ApiSocketDataEvent, ApiSocketEncoding, ApiSocketSessionInfo } from '@/api/types/api-socket'
import { i18n } from '@/locale'
import { interpolateEnv, newKvRow } from '../utils/format'
import { buildHttpRequest, parseHttpResponse } from '../utils/http-wire'
import {
  isSocketMethod,
  parseTarget,
  resolveSocketSendDest,
  socketOpenFields,
  TargetError,
  type SocketTarget,
} from '../utils/target'
import type { ApiEnvironment, ApiExchange, ApiLiveSocket, ApiRequest } from '../types'
import { watchSocketSession } from './useApiSocketHub'

const HTTP_WAIT_MS = 15000
const SOCKET_OPEN_MS = 10000

export type SendErrorCode = 'need-desktop' | 'cancelled' | TargetError['code']

export class SendError extends Error {
  readonly code: SendErrorCode

  constructor(code: SendErrorCode, message: string) {
    super(message)
    this.name = 'SendError'
    this.code = code
  }
}

const SEND_ERROR_KEYS: Record<string, string> = {
  'need-desktop': 'modules.api.needDesktop',
  https: 'modules.api.httpsUnsupported',
  ws: 'modules.api.wsUnsupported',
  'bad-url': 'modules.api.badUrl',
}

export interface ResolvedSend {
  target: SocketTarget
  payload: string
}

/** 经 api-service 发送：HTTP 一发一收；TCP/UDP 由 store 保活会话。 */
export function useApiSend() {
  return {
    resolveSend,
    executeRequest,
    openSocketSession,
    sendSocketFrame,
    closeSocketSession,
    buildLiveExchange,
    failExchange,
    localizeSendError,
    protocolOf,
    SendError,
  }
}

export function resolveSend(req: ApiRequest, env: ApiEnvironment | undefined): ResolvedSend {
  if (!isBridgeAvailable()) {
    throw new SendError('need-desktop', 'desktop only')
  }
  const url = interpolateEnv(req.url.trim(), env)
  let target: SocketTarget
  try {
    target = parseTarget(url, req.method)
  } catch (error) {
    if (error instanceof TargetError) {
      throw new SendError(error.code, error.message)
    }
    throw error
  }
  const payload = target.http
    ? buildHttpRequest(req, env, target.path, target.host, target.port)
    : interpolateEnv(req.body, env)
  return { target, payload }
}

/** 明文 HTTP：打开 TCP、发完整报文、等响应后关闭。 */
export async function executeRequest(
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  signal: AbortSignal,
): Promise<ApiExchange> {
  const { target, payload } = resolveSend(req, env)
  const started = performance.now()

  const session = await apiSocketApi.open({
    kind: target.transport,
    host: target.host,
    port: target.port,
    timeoutMs: HTTP_WAIT_MS,
    encoding: 'utf8',
  })

  const inbound = collectInbound(session.sessionId, signal)
  try {
    throwIfAborted(signal)
    if (payload) {
      await apiSocketApi.send({
        sessionId: session.sessionId,
        data: payload,
        encoding: 'utf8',
        host: target.host,
        port: target.port,
      })
    }
    const frames = await inbound.wait(HTTP_WAIT_MS, req.method)
    const durationMs = Math.max(1, Math.round(performance.now() - started))
    return toHttpExchange(req.method, session.remoteAddr ?? `${target.host}:${target.port}`, frames, durationMs)
  } finally {
    inbound.stop()
    await apiSocketApi.close({ sessionId: session.sessionId }).catch(() => undefined)
  }
}

export async function openSocketSession(target: SocketTarget): Promise<ApiSocketSessionInfo> {
  return apiSocketApi.open({
    kind: target.transport,
    timeoutMs: SOCKET_OPEN_MS,
    encoding: 'utf8',
    ...socketOpenFields(target),
  })
}

export async function sendSocketFrame(
  sessionId: string,
  payload: string,
  target: SocketTarget,
  encoding: ApiSocketEncoding = 'auto',
  peerAddr?: string,
): Promise<void> {
  if (!payload) return
  const dest = resolveSocketSendDest(target, peerAddr)
  await apiSocketApi.send({
    sessionId,
    data: payload,
    encoding,
    host: dest?.host,
    port: dest?.port,
  })
}

export async function closeSocketSession(sessionId: string): Promise<void> {
  await apiSocketApi.close({ sessionId }).catch(() => undefined)
}

export function buildLiveExchange(
  live: ApiLiveSocket,
  frames: readonly ApiSocketDataEvent[],
): ApiExchange {
  const durationMs = Math.max(1, Math.round(performance.now() - live.startedAt))
  const hex = frames.map((frame) => frame.hex ?? '').join('')
  const sizeBytes = frames.reduce((sum, frame) => sum + (frame.bytes ?? 0), 0)
  const inbound = frames.some((frame) => frame.direction === 'in')
  const dead = live.state === 'lost' || live.state === 'closed'
  const headers = [
    newKvRow('sessionId', live.sessionId),
    newKvRow('kind', live.kind),
  ]
  if (live.localAddr) headers.push(newKvRow('local', live.localAddr))
  if (live.remoteAddr) headers.push(newKvRow('peer', live.remoteAddr))
  return {
    ok: !dead || inbound,
    status: null,
    statusText: liveStatusText(live.state, inbound),
    durationMs,
    sizeBytes: sizeBytes || (hex ? Math.floor(hex.length / 2) : 0),
    protocol: live.kind === 'udp' ? 'UDP' : 'TCP',
    headers,
    body: frames.map(formatSocketFrame).join('\n'),
    hex,
  }
}

export function failExchange(error: unknown, durationMs: number, protocol = ''): ApiExchange {
  const message = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    status: null,
    statusText: '',
    durationMs,
    sizeBytes: 0,
    protocol,
    headers: [],
    body: '',
    error: message,
  }
}

export function protocolOf(method: ApiRequest['method']): string {
  if (isSocketMethod(method)) return method
  return 'HTTP/1.1'
}

export function localizeSendError(error: unknown): Error {
  if (!(error instanceof SendError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  const key = SEND_ERROR_KEYS[error.code]
  if (!key) return error
  return new Error(String(i18n.global.t(key)))
}

function liveStatusText(state: string, inbound: boolean): string {
  if (state === 'listening') return 'Listening'
  if (state === 'accepted') return inbound ? 'Received' : 'Accepted'
  if (state === 'connected') return inbound ? 'Received' : 'Connected'
  if (state === 'lost') return 'Lost'
  if (state === 'closed') return 'Closed'
  return inbound ? 'Received' : state || 'Open'
}

function formatSocketFrame(frame: ApiSocketDataEvent): string {
  const dir = frame.direction === 'in' ? 'in' : 'out'
  const who = frame.remoteAddr ? ` ${frame.remoteAddr}` : ''
  const text = frame.data ?? (frame.hex ? `<${frame.bytes ?? Math.floor((frame.hex.length || 0) / 2)} B>` : '')
  return `[${dir}${who}] ${text}`
}

function collectInbound(sessionId: string, signal: AbortSignal) {
  const chunks: ApiSocketDataEvent[] = []
  let closed = false
  let notify: (() => void) | null = null

  const off = watchSocketSession(sessionId, (event) => {
    if (event.type === 'api.socket.data' && event.direction === 'in') {
      chunks.push(event)
      notify?.()
    }
    if (event.type === 'api.session.state' && (event.state === 'lost' || event.state === 'closed')) {
      closed = true
      notify?.()
    }
  })

  async function wait(timeoutMs: number, httpMethod: string): Promise<ApiSocketDataEvent[]> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      throwIfAborted(signal)
      const raw = joinText(chunks)
      const parsed = parseHttpResponse(raw, httpMethod)
      if (parsed?.complete || (closed && parsed)) {
        return chunks
      }
      if (closed && raw) {
        return chunks
      }
      const left = Math.max(1, deadline - Date.now())
      await new Promise<void>((resolve) => {
        notify = resolve
        window.setTimeout(resolve, Math.min(80, left))
      })
      notify = null
    }
    return chunks
  }

  return {
    wait,
    stop() {
      off()
    },
  }
}

function toHttpExchange(
  method: string,
  peer: string,
  frames: ApiSocketDataEvent[],
  durationMs: number,
): ApiExchange {
  const raw = joinText(frames)
  const hex = frames.map((frame) => frame.hex ?? '').join('')
  const sizeBytes = hex ? Math.floor(hex.length / 2) : new TextEncoder().encode(raw).length
  const headers = [newKvRow('peer', peer)]
  const parsed = parseHttpResponse(raw, method)
  if (parsed) {
    return {
      ok: parsed.status < 400,
      status: parsed.status,
      statusText: parsed.statusText,
      durationMs,
      sizeBytes: new TextEncoder().encode(parsed.body).length,
      protocol: 'HTTP/1.1',
      headers: parsed.headers.length ? parsed.headers : headers,
      body: parsed.body,
      hex,
    }
  }
  return {
    ok: Boolean(raw),
    status: null,
    statusText: raw ? 'Incomplete' : 'No reply',
    durationMs,
    sizeBytes,
    protocol: 'HTTP/1.1',
    headers,
    body: raw,
    hex,
  }
}

function joinText(frames: ApiSocketDataEvent[]): string {
  return frames.map((frame) => frame.data ?? '').join('')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new SendError('cancelled', 'cancelled')
  }
}
