/**
 * Platform 瞬态不可用：识别错误并做有界退避重试。
 *
 * 桌面端 Platform 由壳层拉起；dev:hot / 刚 spawn 时偶发未就绪，
 * 业务侧应重试真实 RPC，而不是单独探测「是否就绪」。
 */

/**
 * Platform / 服务尚未就绪：
 * - 壳层 EnsureRunning 失败：`service unavailable: …`
 * - 管道 IO 失败：`platform unavailable: …`（PlatformClient）
 */
export function isPlatformUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false
  }
  const msg = err.message
  return msg.startsWith('service unavailable') || msg.startsWith('platform unavailable')
}

export interface PlatformRetryOptions {
  /** 最大尝试次数（含首次），默认 5 */
  maxAttempts?: number
}

/**
 * 执行 `action`；仅当错误为 Platform 瞬态不可用时按 `150 * attempt` ms 退避重试。
 * 非瞬态错误或重试耗尽时原样抛出。
 */
export async function withPlatformRetry<T>(
  action: () => Promise<T>,
  options?: PlatformRetryOptions,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 5
  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await action()
    } catch (err) {
      lastErr = err
      if (!isPlatformUnavailable(err) || attempt >= maxAttempts - 1) {
        throw err
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 150 * (attempt + 1))
      })
    }
  }
  throw lastErr
}
