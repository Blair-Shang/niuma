import { apiSocketApi } from '@/api'
import type { ApiSocketDataEvent, ApiSocketStateEvent } from '@/api/types/api-socket'

export type ApiSocketEvent = ApiSocketDataEvent | ApiSocketStateEvent
export type ApiSocketHandler = (event: ApiSocketEvent) => void

const handlers = new Map<string, Set<ApiSocketHandler>>()
let offBus: (() => void) | null = null

function isSocketEvent(detail: unknown): detail is ApiSocketEvent {
  if (!detail || typeof detail !== 'object') return false
  const ev = detail as Partial<ApiSocketEvent>
  return typeof ev.sessionId === 'string' && (ev.type === 'api.socket.data' || ev.type === 'api.session.state')
}

function ensureBus(): void {
  if (offBus) return
  offBus = apiSocketApi.onEvent((detail) => {
    if (!isSocketEvent(detail)) return
    const set = handlers.get(detail.sessionId)
    if (!set) return
    for (const handler of set) handler(detail)
  })
}

function releaseBusIfIdle(): void {
  if (handlers.size > 0 || !offBus) return
  offBus()
  offBus = null
}

/**
 * 按 sessionId 分流 api-service 事件。多个请求页签共用一条总线，互不覆盖。
 * 最后一个订阅卸掉后拆掉总线。
 */
export function watchSocketSession(sessionId: string, handler: ApiSocketHandler): () => void {
  if (!sessionId) return () => undefined
  ensureBus()
  let set = handlers.get(sessionId)
  if (!set) {
    set = new Set()
    handlers.set(sessionId, set)
  }
  set.add(handler)
  return () => {
    const current = handlers.get(sessionId)
    if (!current) return
    current.delete(handler)
    if (current.size === 0) handlers.delete(sessionId)
    releaseBusIfIdle()
  }
}
