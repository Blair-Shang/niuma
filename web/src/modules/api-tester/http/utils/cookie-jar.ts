import type { ApiHttpCookie } from '@/api/types/api-http'

const STORAGE_KEY = 'niuma.api.cookies'

let memory: ApiHttpCookie[] = []

/** 读出工作台 Cookie。服务重启后下一次发送会重新种回去。 */
export function loadApiCookies(): ApiHttpCookie[] {
  const stored = readStorage()
  if (stored) {
    memory = stored
  }
  return memory.map((item) => ({ ...item }))
}

/** 删掉一条 Cookie。 */
export function removeApiCookie(name: string, domain: string, path: string): void {
  const next = loadApiCookies().filter(
    (item) => !(item.name === name && item.domain === domain && item.path === path),
  )
  saveApiCookies(next)
}

/** 清空工作台 Cookie。 */
export function clearApiCookies(): void {
  saveApiCookies([])
}

/** 用这一次响应之后的完整 Cookie 罐替换本地副本。 */
export function saveApiCookies(cookies: readonly ApiHttpCookie[]): void {
  memory = cookies.map((item) => ({ ...item }))
  writeStorage(memory)
}

function readStorage(): ApiHttpCookie[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter(isCookie)
  } catch {
    return null
  }
}

function writeStorage(cookies: readonly ApiHttpCookie[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cookies))
  } catch {
    // 隐私模式或配额满时只留在内存里。
  }
}

function isCookie(value: unknown): value is ApiHttpCookie {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ApiHttpCookie>
  return typeof item.name === 'string' && typeof item.value === 'string'
}
