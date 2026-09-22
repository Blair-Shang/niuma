/**
 * HTTP 发送执行。无 Vue 状态，store / Runner 直接 import 具名函数。
 * 拼包走 resolveRequest；本文件开会话、收帧、组 HTTP exchange。
 */
import { apiSocketApi, isBridgeAvailable } from '@/api'
import type { ApiSocketDataEvent } from '@/api/types/api-socket'
import { i18n } from '@/locale'
import { watchSocketSession } from '../utils/socket-hub'
import type { ApiEnvironment, ApiExchange, ApiRequest } from '../types'
import type { ApiVariableScope } from '../utils/folder-tree'
import { newKvRow } from '../utils/format'
import { isSocketMethod, parseTarget, TargetError, type SocketTarget } from '../utils/target'
import { buildHttpRequest, parseHttpResponse } from './http-wire'
import { resolveRequest } from './request-resolve'

const HTTP_WAIT_MS = 15000
/** 无新帧时的收包轮询间隔；有数据仍靠事件立刻醒。 */
const HTTP_POLL_MS = 200

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

export function resolveSend(
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  scope?: ApiVariableScope,
): ResolvedSend {
  if (!isBridgeAvailable()) {
    throw new SendError('need-desktop', 'desktop only')
  }
  const resolved = resolveRequest(req, env, scope)
  let target: SocketTarget
  try {
    target = parseTarget(resolved.url, req.method)
  } catch (error) {
    if (error instanceof TargetError) {
      throw new SendError(error.code, error.message)
    }
    throw error
  }
  const payload = target.http
    ? buildHttpRequest(req.method, target.path, target.host, target.port, resolved)
    : resolved.body
  return { target, payload }
}

/** 明文 HTTP：打开 TCP、发完整报文、等响应后关闭。 */
export async function executeRequest(
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  signal: AbortSignal,
  scope?: ApiVariableScope,
): Promise<ApiExchange> {
  const { target, payload } = resolveSend(req, env, scope)
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
    let lastCount = -1
    while (Date.now() < deadline) {
      throwIfAborted(signal)
      if (chunks.length !== lastCount || closed) {
        lastCount = chunks.length
        const raw = joinText(chunks)
        const parsed = parseHttpResponse(raw, httpMethod)
        if (parsed?.complete || (closed && parsed)) {
          return chunks
        }
        if (closed && raw) {
          return chunks
        }
      }
      const left = Math.max(1, deadline - Date.now())
      await new Promise<void>((resolve) => {
        notify = resolve
        window.setTimeout(resolve, Math.min(HTTP_POLL_MS, left))
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
