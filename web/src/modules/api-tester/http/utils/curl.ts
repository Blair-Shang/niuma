/**
 * 把已解析的 HTTP 请求打成可粘贴的 curl。
 * 解析走 request-resolve，这里不再插值。
 */
import type { ApiEnvironment, ApiRequest } from '../../types'
import type { ApiVariableScope } from '../../utils/folder-tree'
import { titleHttpHeader } from './http-wire'
import { resolveRequest } from './request-resolve'

/** 生成可粘贴的 curl（不含 cookie 文件）。 */
export function buildCurl(
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  scope?: ApiVariableScope,
): string {
  const resolved = resolveRequest(req, env, scope)
  const parts = ['curl']
  if (req.method !== 'GET' && req.method !== 'TCP' && req.method !== 'UDP' && req.method !== 'WS') {
    parts.push('-X', req.method)
  }
  parts.push(shellQuote(resolved.url))

  for (const [key, value] of resolved.headers) {
    parts.push('-H', shellQuote(`${titleHttpHeader(key)}: ${value}`))
  }

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'TCP') {
    return parts.join(' ')
  }
  if (req.bodyMode === 'urlencoded' && resolved.body) {
    parts.push('--data-urlencode', shellQuote(resolved.body))
    return parts.join(' ')
  }
  if (resolved.body) {
    parts.push('--data-raw', shellQuote(resolved.body))
  }
  return parts.join(' ')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
