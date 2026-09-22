import type { ApiAuth, ApiRequest } from '../types'

/** 将结构化 Auth 写入 Header Map（key 小写）；不覆盖用户已填的同名校验由调用方决定。 */
export function applyAuthHeaders(
  req: ApiRequest,
  headers: Map<string, string>,
  interpolate: (text: string) => string,
): void {
  const auth: ApiAuth = req.auth ?? { type: 'none' }
  switch (auth.type) {
    case 'bearer': {
      const token = interpolate(auth.bearer?.token ?? '').trim()
      if (token) headers.set('authorization', `Bearer ${token}`)
      break
    }
    case 'basic': {
      const user = interpolate(auth.basic?.username ?? '')
      const pass = interpolate(auth.basic?.password ?? '')
      if (user || pass) {
        const encoded = btoa(unescape(encodeURIComponent(`${user}:${pass}`)))
        headers.set('authorization', `Basic ${encoded}`)
      }
      break
    }
    case 'apikey': {
      const key = interpolate(auth.apiKey?.key ?? '').trim()
      const value = interpolate(auth.apiKey?.value ?? '')
      if (!key) break
      if (auth.apiKey?.in === 'query') break
      headers.set(key.toLowerCase(), value)
      break
    }
    default:
      break
  }
}

/** API Key 在 query 时的键值对；header 模式返回 null。 */
export function authQueryParam(
  req: ApiRequest,
  interpolate: (text: string) => string,
): { key: string; value: string } | null {
  const auth = req.auth
  if (!auth || auth.type !== 'apikey' || auth.apiKey?.in !== 'query') return null
  const key = interpolate(auth.apiKey.key ?? '').trim()
  if (!key) return null
  return { key, value: interpolate(auth.apiKey.value ?? '') }
}
