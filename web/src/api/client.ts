/**
 * Bridge 传输层 — Web ↔ C++ Shell（cefQuery）。
 * 业务调用请使用 `@/api` 各模块，勿在此层散落 method 字符串。
 */

/** 当前 Web → 壳 请求信封版本，与 Go envelope.Version 对齐。 */
export const BRIDGE_PROTOCOL_VERSION = 1

/**
 * BridgeError 是 cefQuery 失败时的结构化错误。
 *
 * `message` 仍为人可读原因（兼容既有 `catch (e) { e.message }`）；
 * `code` / `traceId` 供日志与跨进程关联。旧壳若回传纯文本，code 为 `internal`。
 */
export class BridgeError extends Error {
  readonly code: string
  readonly traceId: string
  readonly protocolVersion: number

  constructor(
    message: string,
    opts?: { code?: string; traceId?: string; protocolVersion?: number },
  ) {
    super(message)
    this.name = 'BridgeError'
    this.code = opts?.code ?? 'internal'
    this.traceId = opts?.traceId ?? ''
    this.protocolVersion = opts?.protocolVersion ?? 0
  }
}

interface BridgeFailurePayload {
  v?: number
  error?: string
  errorCode?: string
  traceId?: string
}

function parseBridgeFailure(message: string): BridgeError {
  const trimmed = message.trim()
  if (trimmed.startsWith('{')) {
    try {
      const payload = JSON.parse(trimmed) as BridgeFailurePayload
      if (typeof payload.error === 'string' || typeof payload.errorCode === 'string') {
        return new BridgeError(payload.error || payload.errorCode || message, {
          code: payload.errorCode || 'internal',
          traceId: payload.traceId || '',
          protocolVersion: payload.v ?? BRIDGE_PROTOCOL_VERSION,
        })
      }
    } catch {
      // 非 JSON 失败文案：按纯文本处理。
    }
  }
  return new BridgeError(message)
}

/** 调用方取消或 context 取消。 */
export function isBridgeCancelled(err: unknown): boolean {
  return err instanceof BridgeError && err.code === 'cancelled'
}

/** 传输层断开，会话已失效。 */
export function isBridgeLost(err: unknown): boolean {
  return err instanceof BridgeError && err.code === 'lost'
}

/** 请求/查询超时（会话通常仍在）。 */
export function isBridgeTimeout(err: unknown): boolean {
  return err instanceof BridgeError && err.code === 'timeout'
}

/**
 * 检测 CEF Bridge 是否可用。
 *
 * @returns 运行于 `niuma.exe` 等 CEF 壳内时为 `true`
 */
export function isBridgeAvailable(): boolean {
  return typeof globalThis.cefQuery === 'function'
}

/**
 * 发送 Bridge 请求并解析 JSON 结果。
 *
 * @param method - Bridge 方法名，如 `shell.plugin.list`
 * @param params - 可选请求体，将序列化为 JSON
 * @returns Shell 返回的 `result` 字段（已 JSON 解析）
 * @throws 无 cefQuery 或 Shell 返回 failure 时（`BridgeError`）
 */
export async function bridgeInvoke<T>(method: string, params?: unknown): Promise<T> {
  if (!isBridgeAvailable()) {
    throw new BridgeError('cefQuery unavailable — launch via pnpm dev (CEF shell)', {
      code: 'unavailable',
    })
  }

  const id = crypto.randomUUID()
  return new Promise<T>((resolve, reject) => {
    globalThis.cefQuery!({
      request: JSON.stringify({
        v: BRIDGE_PROTOCOL_VERSION,
        method,
        params,
        id,
        traceId: id,
      }),
      onSuccess: (response) => {
        try {
          resolve(JSON.parse(response) as T)
        } catch {
          reject(new BridgeError('invalid bridge JSON response', { code: 'invalid_request', traceId: id }))
        }
      },
      onFailure: (_code, message) => reject(parseBridgeFailure(message)),
    })
  })
}

/**
 * 订阅 Shell 推送的自定义事件（`niuma:event`）。
 *
 * @param handler - 事件 detail 回调
 * @returns 调用后移除监听的取消函数
 */
export function bridgeOnEvent(handler: (detail: unknown) => void): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent).detail)
  }
  globalThis.addEventListener('niuma:event', listener)
  return () => globalThis.removeEventListener('niuma:event', listener)
}
