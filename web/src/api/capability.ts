/**
 * 连接类能力 Bridge 客户端工厂。
 *
 * 与 docs/14-capability-connection-framework.md 会话契约对齐。
 */
import { bridgeInvoke } from '@/api/client'
import { subscribeBridgeEventByPrefix } from '@/api/event-bus'

export interface SessionOpenParams {
  profileId: string
}

export interface SessionOpenResult {
  sessionId: string
}

export interface SessionCloseParams {
  sessionId: string
}

export interface SessionCloseResult {
  closed: boolean
}

export interface SessionTestParams {
  profileId: string
}

export interface SessionTestResult {
  ok: boolean
  message: string
}

export interface SessionStateEvent {
  type: `${string}.session.state`
  sessionId: string
  state: 'connected' | 'closed' | 'lost'
  message?: string
}

/** 为指定 namespace 生成 session 方法与事件过滤（ftp / ssh / 插件 id 等）。 */
export function createCapabilityClient(namespace: string) {
  const prefix = namespace
  return {
    session: {
      open: (params: SessionOpenParams) =>
        bridgeInvoke<SessionOpenResult>(`${prefix}.session.open`, params),
      close: (params: SessionCloseParams) =>
        bridgeInvoke<SessionCloseResult>(`${prefix}.session.close`, params),
      test: (params: SessionTestParams) =>
        bridgeInvoke<SessionTestResult>(`${prefix}.session.test`, params),
    },
    invoke<T>(method: string, params?: unknown) {
      return bridgeInvoke<T>(`${prefix}.${method}`, params)
    },
    onEvent(handler: (detail: unknown) => void) {
      return subscribeBridgeEventByPrefix(`${prefix}.`, handler)
    },
  }
}
