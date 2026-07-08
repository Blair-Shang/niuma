/**
 * Bridge 传输层 — Web ↔ C++ Shell（cefQuery）。
 * 业务调用请使用 `@/api` 各模块，勿在此层散落 method 字符串。
 */

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
 * @throws 无 cefQuery 或 Shell 返回 failure 时
 */
export async function bridgeInvoke<T>(method: string, params?: unknown): Promise<T> {
  if (!isBridgeAvailable()) {
    throw new Error('cefQuery unavailable — launch via pnpm dev (CEF shell)')
  }

  return new Promise<T>((resolve, reject) => {
    globalThis.cefQuery!({
      request: JSON.stringify({ method, params, id: crypto.randomUUID() }),
      onSuccess: (response) => {
        try {
          resolve(JSON.parse(response) as T)
        } catch {
          reject(new Error('invalid bridge JSON response'))
        }
      },
      onFailure: (_code, message) => reject(new Error(message)),
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
