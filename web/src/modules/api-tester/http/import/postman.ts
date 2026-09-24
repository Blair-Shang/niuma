/**
 * Postman Collection v2.0 / v2.1 → 文件夹树。
 * 超过 3 层的请求并进最深允许的文件夹。集合变量写到根文件夹 vars。
 */
import type { ApiAuth, ApiBodyMode, ApiFolder, ApiKvRow, ApiMethod, ApiRequest } from '../../types'
import { defaultAuth } from '../../utils/collection-io'
import { MAX_FOLDER_DEPTH, normalizeFolderGraph } from '../../utils/folder-tree'
import { asImportText, dedupeRequestNames, importedFolder, importedRequest, kv } from './request'

const METHODS = new Set<ApiMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])

interface BuiltFolder {
  name: string
  vars: Record<string, string>
  requests: ApiRequest[]
  children: BuiltFolder[]
}

export function isPostmanCollection(root: Record<string, unknown>): boolean {
  const info = root.info
  if (!info || typeof info !== 'object') return false
  const schema = asImportText((info as Record<string, unknown>).schema)
  return /schema\.getpostman\.com\/json\/collection\/v2\.\d+\.\d+\/collection\.json/.test(schema)
}

function readVariables(raw: unknown): Record<string, string> {
  if (!Array.isArray(raw)) return {}
  const vars: Record<string, string> = {}
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const key = asImportText(item.key).trim()
    if (!key || item.disabled === true) continue
    vars[key] = asImportText(item.value)
  }
  return vars
}

function authEntries(raw: unknown): Record<string, string> {
  if (!Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const key = asImportText(item.key).trim()
    if (key) out[key] = asImportText(item.value)
  }
  return out
}

function readPostmanAuth(raw: unknown, inherited: ApiAuth): ApiAuth {
  if (!raw || typeof raw !== 'object') return inherited
  const item = raw as Record<string, unknown>
  const type = asImportText(item.type).toLowerCase()
  if (!type || type === 'inherit') return inherited
  if (type === 'noauth') return defaultAuth()
  if (type === 'bearer') {
    const token = authEntries(item.bearer).token ?? ''
    return { type: 'bearer', bearer: { token } }
  }
  if (type === 'basic') {
    const fields = authEntries(item.basic)
    return { type: 'basic', basic: { username: fields.username ?? '', password: fields.password ?? '' } }
  }
  if (type === 'apikey') {
    const fields = authEntries(item.apikey)
    return {
      type: 'apikey',
      apiKey: {
        key: fields.key ?? '',
        value: fields.value ?? '',
        in: fields.in === 'query' ? 'query' : 'header',
      },
    }
  }
  return inherited
}

function readQuery(raw: unknown): ApiKvRow[] {
  if (!Array.isArray(raw)) return []
  const rows: ApiKvRow[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const key = asImportText(item.key).trim()
    if (!key) continue
    rows.push(kv(key, asImportText(item.value), item.disabled !== true))
  }
  return rows
}

function readHeaders(raw: unknown): ApiKvRow[] {
  if (!Array.isArray(raw)) return []
  const rows: ApiKvRow[] = []
  for (const row of raw) {
    if (typeof row === 'string') {
      const colon = row.indexOf(':')
      if (colon <= 0) continue
      const key = row.slice(0, colon).trim()
      if (key && key.toLowerCase() !== 'authorization') rows.push(kv(key, row.slice(colon + 1).trim()))
      continue
    }
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const key = asImportText(item.key).trim()
    if (!key || key.toLowerCase() === 'authorization') continue
    rows.push(kv(key, asImportText(item.value), item.disabled !== true))
  }
  return rows
}

function readPostmanUrl(raw: unknown): { url: string; params: ApiKvRow[] } {
  if (typeof raw === 'string') {
    const hash = raw.indexOf('#')
    const clean = hash >= 0 ? raw.slice(0, hash) : raw
    const q = clean.indexOf('?')
    if (q < 0) return { url: clean, params: [] }
    return { url: clean.slice(0, q), params: readLooseQuery(clean.slice(q + 1)) }
  }
  if (!raw || typeof raw !== 'object') return { url: '', params: [] }
  const item = raw as Record<string, unknown>
  const query = Array.isArray(item.query) ? readQuery(item.query) : null
  const rawUrl = asImportText(item.raw)
  if (rawUrl) {
    const hash = rawUrl.indexOf('#')
    const clean = hash >= 0 ? rawUrl.slice(0, hash) : rawUrl
    const base = query ? (clean.split('?')[0] ?? clean) : clean
    if (query) return { url: base, params: query }
    const q = base.indexOf('?')
    if (q < 0) return { url: base, params: [] }
    return { url: base.slice(0, q), params: readLooseQuery(base.slice(q + 1)) }
  }
  const protocol = asImportText(item.protocol)
  const host = Array.isArray(item.host) ? item.host.map((part) => asImportText(part)).filter(Boolean).join('.') : asImportText(item.host)
  const path = Array.isArray(item.path) ? item.path.map((part) => asImportText(part)).filter(Boolean).join('/') : asImportText(item.path).replace(/^\/+/, '')
  let url = ''
  if (host.includes('://') || host.startsWith('{{')) url = host
  else if (host) url = `${protocol || 'https'}://${host}`
  if (path) url = `${url.replace(/\/+$/, '')}/${path}`
  return { url, params: query ?? [] }
}

function readLooseQuery(query: string): ApiKvRow[] {
  const rows: ApiKvRow[] = []
  for (const part of query.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = eq < 0 ? part : part.slice(0, eq)
    if (!key) continue
    rows.push(kv(key, eq < 0 ? '' : part.slice(eq + 1)))
  }
  return rows
}

function readPostmanBody(raw: unknown): { bodyMode: ApiBodyMode; body: string; bodyForm: ApiKvRow[] } {
  if (!raw || typeof raw !== 'object') return { bodyMode: 'none', body: '', bodyForm: [] }
  const item = raw as Record<string, unknown>
  const mode = asImportText(item.mode)
  if (mode === 'urlencoded') {
    return { bodyMode: 'urlencoded', body: '', bodyForm: readQuery(item.urlencoded) }
  }
  if (mode === 'formdata') {
    return { bodyMode: 'form', body: '', bodyForm: readFormData(item.formdata) }
  }
  if (mode === 'graphql' && item.graphql && typeof item.graphql === 'object') {
    const graphql = item.graphql as Record<string, unknown>
    const query = asImportText(graphql.query)
    let variables: unknown = asImportText(graphql.variables)
    if (typeof variables === 'string' && variables.trim()) {
      try {
        variables = JSON.parse(variables) as unknown
      } catch {
        // 保留原文，方便用户改
      }
    }
    return {
      bodyMode: 'json',
      body: JSON.stringify({ query, variables: variables || {} }, null, 2),
      bodyForm: [],
    }
  }
  if (mode === 'file' && item.file && typeof item.file === 'object') {
    return { bodyMode: 'raw', body: asImportText((item.file as Record<string, unknown>).src), bodyForm: [] }
  }
  const text = asImportText(item.raw)
  if (!text && mode !== 'raw') return { bodyMode: 'none', body: '', bodyForm: [] }
  const language = rawLanguage(item.options)
  if (language === 'json' || looksLikeJson(text)) return { bodyMode: 'json', body: text, bodyForm: [] }
  if (language === 'text' || language === 'html') return { bodyMode: 'text', body: text, bodyForm: [] }
  return { bodyMode: text ? 'raw' : 'none', body: text, bodyForm: [] }
}

function readFormData(raw: unknown): ApiKvRow[] {
  if (!Array.isArray(raw)) return []
  const rows: ApiKvRow[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const key = asImportText(item.key).trim()
    if (!key) continue
    const value = item.type === 'file' ? asImportText(item.src) : asImportText(item.value)
    rows.push(kv(key, value, item.disabled !== true))
  }
  return rows
}

function rawLanguage(options: unknown): string {
  if (!options || typeof options !== 'object') return ''
  const raw = (options as Record<string, unknown>).raw
  if (!raw || typeof raw !== 'object') return ''
  return asImportText((raw as Record<string, unknown>).language).toLowerCase()
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function readPostmanRequest(item: Record<string, unknown>, inherited: ApiAuth): ApiRequest | null {
  const request = item.request
  if (!request) return null
  const name = asImportText(item.name).trim() || 'Request'
  if (typeof request === 'string') {
    const located = readPostmanUrl(request)
    return importedRequest({ name, url: located.url, params: located.params, auth: inherited })
  }
  if (typeof request !== 'object') return null
  const req = request as Record<string, unknown>
  const methodRaw = asImportText(req.method).toUpperCase()
  const method: ApiMethod = METHODS.has(methodRaw as ApiMethod) ? (methodRaw as ApiMethod) : 'GET'
  const located = readPostmanUrl(req.url)
  const body = readPostmanBody(req.body)
  return importedRequest({
    name,
    method,
    url: located.url,
    params: located.params,
    headers: readHeaders(req.header),
    auth: readPostmanAuth(req.auth, inherited),
    bodyMode: body.bodyMode,
    body: body.body,
    bodyForm: body.bodyForm,
  })
}

function walkItems(items: unknown, inherited: ApiAuth): { requests: ApiRequest[]; folders: BuiltFolder[] } {
  const requests: ApiRequest[] = []
  const folders: BuiltFolder[] = []
  if (!Array.isArray(items)) return { requests, folders }
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const name = asImportText(item.name).trim() || 'Untitled'
    if (Array.isArray(item.item)) {
      const auth = readPostmanAuth(item.auth, inherited)
      const nested = walkItems(item.item, auth)
      const own = item.request ? readPostmanRequest(item, auth) : null
      folders.push({
        name,
        vars: readVariables(item.variable),
        requests: own ? [own, ...nested.requests] : nested.requests,
        children: nested.folders,
      })
      continue
    }
    const req = readPostmanRequest(item, inherited)
    if (req) requests.push(req)
  }
  return { requests, folders }
}

function collectRequests(nodes: BuiltFolder[]): ApiRequest[] {
  const out: ApiRequest[] = []
  for (const node of nodes) {
    out.push(...node.requests, ...collectRequests(node.children))
  }
  return out
}

function emit(built: BuiltFolder, parentId: string | null, depth: number, out: ApiFolder[]): void {
  const requests = depth >= MAX_FOLDER_DEPTH
    ? [...built.requests, ...collectRequests(built.children)]
    : [...built.requests]
  dedupeRequestNames(requests)
  const folder = importedFolder(built.name, parentId, requests, built.vars)
  out.push(folder)
  if (depth >= MAX_FOLDER_DEPTH) return
  for (const child of built.children) emit(child, folder.id, depth + 1, out)
}

/** 解析 Postman v2 JSON。不是该格式时返回 null。 */
export function importPostman(root: Record<string, unknown>): ApiFolder[] | null {
  if (!isPostmanCollection(root)) return null
  const info = root.info as Record<string, unknown>
  const auth = readPostmanAuth(root.auth, defaultAuth())
  const nested = walkItems(root.item, auth)
  const folders: ApiFolder[] = []
  emit(
    {
      name: asImportText(info.name).trim() || 'Postman',
      vars: readVariables(root.variable),
      requests: nested.requests,
      children: nested.folders,
    },
    null,
    1,
    folders,
  )
  return normalizeFolderGraph(folders)
}
