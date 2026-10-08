/**
 * 把已解析的 HTTP 请求打成可粘贴的 curl。
 * 解析走 request-resolve，这里不再插值。
 */
import type { ApiEnvironment, ApiKvRow, ApiRequest } from '../../types'
import type { ApiVariableScope } from '../../utils/folder-tree'
import { applyMessageHeaders, titleHttpHeader } from './http-wire'
import { interpolateVariables, resolveRequest } from './request-resolve'
import { timeoutMsOf } from '../settings/settings'

/** 生成可粘贴的 curl（不含 cookie 文件）。多行，表单用 -F。 */
export function buildCurl(
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  scope?: ApiVariableScope,
): string {
  const resolved = resolveRequest(req, env, scope)
  const lines: string[] = []
  let head = 'curl'
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'TCP' && req.method !== 'UDP' && req.method !== 'WS') {
    head += ` -X ${req.method}`
  }
  head += ` ${shellQuote(resolved.url)}`
  lines.push(head)
  const proxy = interpolateVariables(req.settings?.proxy ?? '', resolved.values).trim()
  if (proxy) lines.push(`  --proxy ${shellQuote(proxy)}`)
  const cert = interpolateVariables(req.settings?.certPath ?? '', resolved.values).trim()
  const key = interpolateVariables(req.settings?.keyPath ?? '', resolved.values).trim()
  if (cert && key) {
    lines.push(`  --cert ${shellQuote(cert)}`)
    lines.push(`  --key ${shellQuote(key)}`)
  }
  if (req.insecureTLS) lines.push('  --insecure')
  const timeoutMs = timeoutMsOf(req.settings)
  if (req.settings && timeoutMs !== 30_000) {
    lines.push(`  --max-time ${Math.max(1, Math.ceil(timeoutMs / 1000))}`)
  }

  const headers = applyMessageHeaders(req.method, resolved.body, resolved.headers)
  const form = req.bodyMode === 'form'
  const encoded = req.bodyMode === 'urlencoded'
  for (const [key, value] of headers) {
    if (form && key === 'content-type') continue
    if ((form || encoded) && key === 'content-length') continue
    lines.push(`  -H ${shellQuote(`${titleHttpHeader(key)}: ${value}`)}`)
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (form) {
      for (const field of enabledFields(req.bodyForm, resolved.values)) {
        lines.push(`  -F ${shellQuote(`${field.key}=${field.value}`)}`)
      }
    } else if (req.bodyMode === 'urlencoded') {
      for (const field of enabledFields(req.bodyForm, resolved.values)) {
        lines.push(`  --data-urlencode ${shellQuote(`${field.key}=${field.value}`)}`)
      }
    } else if (resolved.body) {
      lines.push(`  --data-raw ${shellQuote(resolved.body)}`)
    }
  }

  return lines.join(' \\\n')
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function enabledFields(
  rows: ApiKvRow[] | undefined,
  values: Record<string, string>,
): { key: string; value: string }[] {
  return (rows ?? [])
    .filter((row) => row.enabled && row.key.trim())
    .map((row) => {
      const filePath = row.filePath?.trim()
      const value = filePath
        ? `@${interpolateVariables(filePath, values)}`
        : interpolateVariables(row.value, values)
      return { key: row.key.trim(), value }
    })
}
