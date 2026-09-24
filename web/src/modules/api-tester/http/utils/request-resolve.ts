/**
 * 发送管线的解析层（无 IO）。
 * UI / curl / Runner 都走 resolveRequest，禁止在组件里拼 Header 或私自插值。
 * HTTP/1.1 字节串仍由 http-wire 负责。
 */
import { createId } from '@/utils/id'
import type { ApiEnvironment, ApiFolder, ApiKvRow, ApiRequest, ApiVariableBag } from '../../types'
import type { ApiVariableScope } from '../../utils/folder-tree'
import { applyAuthHeaders, authQueryParam } from './http-auth'

const ENV_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/** 变量插值上下文：globals → 文件夹链 → 环境。 */
export interface ApiVariableContext {
  globals: Record<string, string>
  folderVars: Record<string, string>[]
  environment?: ApiEnvironment
}

/**
 * 已插值的请求：URL（含 query / auth query）、Header、Body。
 * 给 curl、历史栏、executeRequest 共用。
 */
export interface ResolvedRequest {
  url: string
  headers: Map<string, string>
  body: string
  contentType?: string
  values: Record<string, string>
  authQuery: { key: string; value: string } | null
}

/** 合并变量表；后者覆盖前者。 */
export function mergeVariableMaps(...maps: readonly Record<string, string>[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      out[key] = value
    }
  }
  return out
}

/** 从根到叶收集文件夹 vars。上行用 seen，parentId 环不会转起来。 */
export function folderVariableChain(folders: readonly ApiFolder[], folderId: string | null | undefined): Record<string, string>[] {
  if (!folderId) return []
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const chain: Record<string, string>[] = []
  const seen = new Set<string>()
  let current = byId.get(folderId)
  const parents: ApiFolder[] = []
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    parents.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    chain.push(parents[i]!.vars)
  }
  return chain
}

/** 构造完整变量上下文。 */
export function buildVariableContext(opts: {
  globals?: ApiVariableBag
  folders?: readonly ApiFolder[]
  folderId?: string | null
  environment?: ApiEnvironment
}): ApiVariableContext {
  return {
    globals: { ...(opts.globals?.vars ?? {}) },
    folderVars: folderVariableChain(opts.folders ?? [], opts.folderId),
    environment: opts.environment,
  }
}

/** 按优先级合并为 flat map（含 baseUrl）。 */
export function buildVariableMap(ctx: ApiVariableContext): Record<string, string> {
  const maps: Record<string, string>[] = [ctx.globals]
  maps.push(...ctx.folderVars)
  if (ctx.environment) {
    maps.push(ctx.environment.vars)
    maps.push({ baseUrl: ctx.environment.baseUrl })
  }
  return mergeVariableMaps(...maps)
}

/** 将 {{name}} 替换为变量值；未知 token 保留原文。 */
export function interpolateVariables(text: string, values: Record<string, string>): string {
  if (!text) return ''
  return text.replace(ENV_TOKEN, (_all, name: string) => values[name] ?? `{{${name}}}`)
}

function enabledKv(rows: readonly ApiKvRow[]): ApiKvRow[] {
  return rows.filter((row) => row.enabled && row.key.trim())
}

function appendQuery(url: string, key: string, value: string): string {
  const join = url.includes('?') ? '&' : '?'
  return `${url}${join}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

/** 按 bodyMode 编码；GET/HEAD 不带 body。 */
export function resolveRequestBody(
  req: ApiRequest,
  interpolate: (text: string) => string,
): { body: string; contentType?: string } {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return { body: '' }
  }
  if (req.bodyMode === 'urlencoded') {
    const body = enabledKv(req.bodyForm ?? [])
      .map((row) => `${encodeURIComponent(row.key)}=${encodeURIComponent(interpolate(row.value))}`)
      .join('&')
    return { body, contentType: 'application/x-www-form-urlencoded' }
  }
  if (req.bodyMode === 'form') {
    const boundary = `----NiuMaForm${createId('part')}`
    const parts = enabledKv(req.bodyForm ?? []).map(
      (row) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${row.key}"\r\n\r\n${interpolate(row.value)}\r\n`,
    )
    return {
      body: `${parts.join('')}--${boundary}--\r\n`,
      contentType: `multipart/form-data; boundary=${boundary}`,
    }
  }
  const body = interpolate(req.body)
  if (!body) return { body: '' }
  if (req.bodyMode === 'json' && !req.headers.some((row) => row.enabled && row.key.toLowerCase() === 'content-type')) {
    return { body, contentType: 'application/json; charset=utf-8' }
  }
  if (req.bodyMode === 'text') {
    return { body, contentType: 'text/plain; charset=utf-8' }
  }
  return { body }
}

/**
 * 统一解析：变量 → URL/Params → Auth → Body。
 * 发送与 curl 必须调这个，不要再各自拼一遍。
 */
export function resolveRequest(
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  scope?: ApiVariableScope,
): ResolvedRequest {
  const values = buildVariableMap(
    buildVariableContext({
      globals: scope?.globals,
      folders: scope?.folders,
      folderId: scope?.folderId,
      environment: env,
    }),
  )
  const interpolate = (text: string) => interpolateVariables(text, values)

  let url = interpolate(req.url.trim())
  for (const row of enabledKv(req.params)) {
    url = appendQuery(url, row.key, interpolate(row.value))
  }
  const authQuery = authQueryParam(req, interpolate)
  if (authQuery) {
    url = appendQuery(url, authQuery.key, authQuery.value)
  }

  const headers = new Map<string, string>()
  for (const row of enabledKv(req.headers)) {
    const key = row.key.trim()
    if (!key) continue
    headers.set(key.toLowerCase(), interpolate(row.value))
  }
  applyAuthHeaders(req, headers, interpolate)

  const encoded = resolveRequestBody(req, interpolate)
  if (encoded.contentType && !headers.has('content-type')) {
    headers.set('content-type', encoded.contentType)
  }

  return {
    url,
    headers,
    body: encoded.body,
    contentType: encoded.contentType,
    values,
    authQuery,
  }
}
