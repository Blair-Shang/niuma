/**
 * Shell 事件总线 — 全应用仅一个 `niuma:event` 监听，按订阅过滤后分发。
 *
 * 多 Tab（keep-alive）场景下避免每个 FtpSession / SshSession 各自挂监听；
 * platform 批量帧 `platform.event.batch` 在此拆包。
 */
import { bridgeOnEvent } from '@/api/client'

type BridgeEventHandler = (detail: unknown) => void

const subscribers = new Set<BridgeEventHandler>()
let started = false

function unwrapDetail(detail: unknown): unknown[] {
  if (typeof detail !== 'object' || detail === null) {
    return [detail]
  }
  const d = detail as Record<string, unknown>
  if (d.type === 'platform.event.batch' && Array.isArray(d.events)) {
    return d.events
  }
  return [detail]
}

/** 启动全局监听（幂等，应用入口调用一次）。 */
export function ensureBridgeEventBus(): void {
  if (started) {
    return
  }
  started = true
  bridgeOnEvent((detail) => {
    for (const item of unwrapDetail(detail)) {
      for (const fn of subscribers) {
        fn(item)
      }
    }
  })
}

/**
 * 订阅 Bridge 事件。
 *
 * @param handler - 单条事件回调（批量帧已拆包）
 * @returns 取消订阅
 */
export function subscribeBridgeEvent(handler: BridgeEventHandler): () => void {
  ensureBridgeEventBus()
  subscribers.add(handler)
  return () => {
    subscribers.delete(handler)
  }
}

/**
 * 带 type 前缀过滤的订阅（用于 `ftp.*` / `ssh.*` 等命名空间）。
 */
export function subscribeBridgeEventByPrefix(
  prefix: string,
  handler: BridgeEventHandler,
): () => void {
  return subscribeBridgeEvent((detail) => {
    if (
      typeof detail === 'object' &&
      detail !== null &&
      'type' in detail &&
      typeof (detail as { type: string }).type === 'string' &&
      (detail as { type: string }).type.startsWith(prefix)
    ) {
      handler(detail)
    }
  })
}
