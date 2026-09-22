/**
 * 统一 ID 生成。业务代码只调 createId，不要自己写 Math.random / Date.now。
 * 优先 crypto.randomUUID；不支持时才走 fallbackId。
 */
export function createId(prefix = ''): string {
  const core = randomCore()
  return prefix ? `${prefix}-${core}` : core
}

function randomCore(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return fallbackId()
}

/** 无 Web Crypto 时的回退；Math 只允许出现在这一处。 */
function fallbackId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
