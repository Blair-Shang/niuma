/**
 * niuma-cloud HTTP 客户端（账户 / 反馈）。
 * Base URL：`VITE_CLOUD_API_BASE`
 * - 开发默认：`http://127.0.0.1:8090/cloud`
 * - 生产：`https://www.niuma007.com/cloud`
 */

const DEFAULT_BASE = import.meta.env.DEV
  ? 'http://127.0.0.1:8090/cloud'
  : 'https://www.niuma007.com/cloud'

export function cloudApiBase(): string {
  const raw = (import.meta.env.VITE_CLOUD_API_BASE as string | undefined) || DEFAULT_BASE
  return raw.replace(/\/$/, '')
}

export class CloudApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
    this.name = 'CloudApiError'
  }
}

export async function cloudFetch<T>(
  path: string,
  options: RequestInit & { accessToken?: string | null } = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Accept', 'application/json')
  if (options.accessToken) {
    headers.set('Authorization', `Bearer ${options.accessToken}`)
  }
  let res: Response
  try {
    res = await fetch(`${cloudApiBase()}${path}`, {
      ...options,
      headers,
    })
  } catch (err) {
    // 浏览器常见文案：Failed to fetch / NetworkError / Load failed
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err
    }
    throw new CloudApiError('network_error', 0)
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    throw new CloudApiError(data.error || `http_${res.status}`, res.status)
  }
  return data as T
}
