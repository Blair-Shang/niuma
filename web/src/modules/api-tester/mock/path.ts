/** 从请求 URL 取出路径，供 Mock 路由使用。 */
export function pathOfUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return '/'
  try {
    if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed).pathname || '/'
  } catch {
    /* 相对地址走下面的截取 */
  }
  const slash = trimmed.indexOf('/')
  if (slash < 0) return '/'
  const path = trimmed.slice(slash).split('?')[0] || '/'
  return path.startsWith('/') ? path : `/${path}`
}
