/**
 * 统一 ID 生成工具。
 * 优先使用 `crypto.randomUUID()`，在不支持的运行环境回退到时间戳+随机串。
 */
export function createId(prefix = ''): string {
  const hasCrypto = globalThis.crypto !== undefined
  const hasRandomUuid = hasCrypto && typeof globalThis.crypto.randomUUID === 'function'

  const core = hasRandomUuid
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

  return prefix ? `${prefix}${core}` : core
}

