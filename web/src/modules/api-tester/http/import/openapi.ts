/**
 * OpenAPI 3 JSON → 文件夹树。
 * 根文件夹用 info.title，按第一个 tag 分子文件夹。路径参数 {id} 写成 {{id}}。
 * 不生成 Mock 路由（见 docs/39）。
 */
import type { ApiAuth, ApiBodyMode, ApiFolder, ApiKvRow, ApiMethod, ApiRequest } from '../../types'
import { defaultAuth } from '../../utils/collection-io'
import { normalizeFolderGraph } from '../../utils/folder-tree'
import { asImportText, dedupeRequestNames, importedFolder, importedRequest, kv } from './request'

const METHODS = new Set<ApiMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])

interface OpParam {
  name: string
  in: string
  enabled: boolean
  value: string
}

export function isOpenApiDocument(root: Record<string, unknown>): boolean {
  return asImportText(root.openapi).startsWith('3.')
}

function resolveRef(doc: Record<string, unknown>, ref: string, seen: Set<string>): unknown {
  if (!ref.startsWith('#/') || seen.has(ref)) return undefined
  seen.add(ref)
  const parts = ref.slice(2).split('/').map((part) => {
    try {
      return decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'))
    } catch {
      return part
    }
  })
  let current: unknown = doc
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function scalarString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function sampleFromSchema(schema: unknown, doc: Record<string, unknown>, depth = 0, seen?: Set<string>): unknown {
  if (depth > 3) return undefined
  const node = asObject(schema)
  if (!node) return undefined
  if (typeof node.$ref === 'string') {
    if (seen?.has(node.$ref)) return undefined
    const nextSeen = new Set(seen)
    nextSeen.add(node.$ref)
    const next = resolveRef(doc, node.$ref, new Set())
    return sampleFromSchema(next, doc, depth + 1, nextSeen)
  }
  if ('example' in node) return node.example
  if ('default' in node) return node.default
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0]
  const type = asImportText(node.type)
  if (type === 'object' || node.properties) {
    const props = asObject(node.properties) ?? {}
    const out: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(props)) {
      const sample = sampleFromSchema(prop, doc, depth + 1, seen)
      if (sample !== undefined) out[key] = sample
    }
    return out
  }
  if (type === 'array') {
    const item = sampleFromSchema(node.items, doc, depth + 1, seen)
    return item === undefined ? [] : [item]
  }
  if (type === 'integer' || type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'string') return ''
  return undefined
}

function stringifyExample(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function mediaExample(media: unknown, doc: Record<string, unknown>): string {
  const node = asObject(media)
  if (!node) return ''
  if ('example' in node && node.example !== undefined) return stringifyExample(node.example)
  const examples = asObject(node.examples)
  if (examples) {
    const first = Object.values(examples)[0]
    const wrapped = asObject(first)
    if (wrapped && 'value' in wrapped) return stringifyExample(wrapped.value)
  }
  const sample = sampleFromSchema(node.schema, doc)
  if (sample === undefined) return ''
  return stringifyExample(sample)
}

function readBody(content: unknown, doc: Record<string, unknown>): { bodyMode: ApiBodyMode; body: string; bodyForm: ApiKvRow[] } {
  const node = asObject(content)
  if (!node) return { bodyMode: 'none', body: '', bodyForm: [] }
  const json = node['application/json'] ?? node['application/*+json']
  if (json) {
    const body = mediaExample(json, doc)
    return { bodyMode: body ? 'json' : 'none', body, bodyForm: [] }
  }
  const urlencoded = node['application/x-www-form-urlencoded']
  if (urlencoded) return formFromMedia(urlencoded, doc, 'urlencoded')
  const multipart = node['multipart/form-data']
  if (multipart) return formFromMedia(multipart, doc, 'form')
  const textKey = Object.keys(node).find((key) => key.startsWith('text/'))
  if (textKey) {
    const body = mediaExample(node[textKey], doc)
    return { bodyMode: body ? 'text' : 'none', body, bodyForm: [] }
  }
  return { bodyMode: 'none', body: '', bodyForm: [] }
}

function formFromMedia(
  media: unknown,
  doc: Record<string, unknown>,
  mode: 'urlencoded' | 'form',
): { bodyMode: ApiBodyMode; body: string; bodyForm: ApiKvRow[] } {
  const node = asObject(media)
  const schema = node ? deref(node.schema, doc) : null
  const props = asObject(schema?.properties) ?? {}
  const rows = Object.keys(props).map((key) => {
    const sample = sampleFromSchema(props[key], doc)
    return kv(key, scalarString(sample) ?? '')
  })
  if (rows.length === 0) {
    const example = node ? mediaExample(node, doc) : ''
    if (example && mode === 'urlencoded') {
      return { bodyMode, body: '', bodyForm: loosePairs(example) }
    }
  }
  return { bodyMode: rows.length ? mode : 'none', body: '', bodyForm: rows }
}

function loosePairs(body: string): ApiKvRow[] {
  const rows: ApiKvRow[] = []
  for (const part of body.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = (eq < 0 ? part : part.slice(0, eq)).trim()
    if (!key) continue
    rows.push(kv(key, eq < 0 ? '' : part.slice(eq + 1)))
  }
  return rows
}

function deref(schema: unknown, doc: Record<string, unknown>): Record<string, unknown> | null {
  const node = asObject(schema)
  if (!node) return null
  if (typeof node.$ref === 'string') return asObject(resolveRef(doc, node.$ref, new Set()))
  return node
}

function paramValue(param: Record<string, unknown>, doc: Record<string, unknown>): string {
  const direct = scalarString(param.example)
  if (direct !== null) return direct
  const schema = deref(param.schema, doc)
  if (!schema) return ''
  return scalarString(schema.example) ?? scalarString(schema.default) ?? ''
}

function readParameters(raw: unknown, doc: Record<string, unknown>): OpParam[] {
  if (!Array.isArray(raw)) return []
  const rows: OpParam[] = []
  for (const item of raw) {
    const node = asObject(item)
    if (!node) continue
    const resolved = typeof node.$ref === 'string' ? asObject(resolveRef(doc, node.$ref, new Set())) : node
    if (!resolved) continue
    const name = asImportText(resolved.name).trim()
    const place = asImportText(resolved.in)
    if (!name || !place || place === 'cookie' || place === 'body') continue
    rows.push({
      name,
      in: place,
      enabled: resolved.deprecated !== true,
      value: paramValue(resolved, doc),
    })
  }
  return rows
}

function mergeParams(pathLevel: OpParam[], opLevel: OpParam[]): OpParam[] {
  const out = [...pathLevel]
  for (const row of opLevel) {
    const index = out.findIndex((item) => item.name === row.name && item.in === row.in)
    if (index >= 0) out[index] = row
    else out.push(row)
  }
  return out
}

function readSecuritySchemes(doc: Record<string, unknown>): Map<string, ApiAuth> {
  const schemes = new Map<string, ApiAuth>()
  const components = asObject(doc.components)
  const table = asObject(components?.securitySchemes)
  if (!table) return schemes
  for (const [name, raw] of Object.entries(table)) {
    const node = typeof (raw as Record<string, unknown> | null)?.$ref === 'string'
      ? asObject(resolveRef(doc, asImportText((raw as Record<string, unknown>).$ref), new Set()))
      : asObject(raw)
    if (!node) continue
    const type = asImportText(node.type)
    const scheme = asImportText(node.scheme).toLowerCase()
    if (type === 'http' && scheme === 'bearer') {
      schemes.set(name, { type: 'bearer', bearer: { token: '{{token}}' } })
    } else if (type === 'http' && scheme === 'basic') {
      schemes.set(name, { type: 'basic', basic: { username: '{{username}}', password: '{{password}}' } })
    } else if (type === 'apiKey') {
      const key = asImportText(node.name).trim()
      if (!key) continue
      schemes.set(name, {
        type: 'apikey',
        apiKey: { key, value: '{{apiKey}}', in: node.in === 'query' ? 'query' : 'header' },
      })
    }
  }
  return schemes
}

function pickAuth(security: unknown, schemes: Map<string, ApiAuth>, fallback: ApiAuth): ApiAuth {
  if (!Array.isArray(security)) return fallback
  if (security.length === 0) return defaultAuth()
  const first = asObject(security[0])
  if (!first) return fallback
  for (const name of Object.keys(first)) {
    const auth = schemes.get(name)
    if (auth) return auth
  }
  return fallback
}

function serverUrl(doc: Record<string, unknown>): string {
  if (!Array.isArray(doc.servers) || doc.servers.length === 0) return ''
  const first = asObject(doc.servers[0])
  const url = asImportText(first?.url).trim()
  if (!url) return ''
  return url.replace(/\/+$/, '').replace(/\{([^{}]+)\}/g, '{{$1}}')
}

function toNiuMaPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `{{baseUrl}}${normalized.replace(/\{([^{}]+)\}/g, '{{$1}}')}`
}

function operationName(method: string, path: string, op: Record<string, unknown>): string {
  const summary = asImportText(op.summary).trim()
  if (summary) return summary
  const operationId = asImportText(op.operationId).trim()
  if (operationId) return operationId
  return `${method} ${path}`
}

function firstTag(op: Record<string, unknown>): string {
  if (!Array.isArray(op.tags)) return ''
  const tag = op.tags.find((item) => typeof item === 'string' && item.trim())
  return typeof tag === 'string' ? tag.trim() : ''
}

/** 解析 OpenAPI 3 JSON。不是该格式或没有 paths 时返回 null。 */
export function importOpenApi(root: Record<string, unknown>): ApiFolder[] | null {
  if (!isOpenApiDocument(root)) return null
  const paths = asObject(root.paths)
  if (!paths) return null
  const info = asObject(root.info)
  const title = asImportText(info?.title).trim() || 'OpenAPI'
  const base = serverUrl(root)
  const schemes = readSecuritySchemes(root)
  const docAuth = pickAuth(root.security, schemes, defaultAuth())
  const groups = new Map<string, ApiRequest[]>()

  for (const [path, rawItem] of Object.entries(paths)) {
    const pathItem = typeof (rawItem as Record<string, unknown> | null)?.$ref === 'string'
      ? asObject(resolveRef(root, asImportText((rawItem as Record<string, unknown>).$ref), new Set()))
      : asObject(rawItem)
    if (!pathItem) continue
    const pathParams = readParameters(pathItem.parameters, root)
    for (const method of METHODS) {
      const op = asObject(pathItem[method.toLowerCase()])
      if (!op) continue
      const params = mergeParams(pathParams, readParameters(op.parameters, root))
      const query = params.filter((row) => row.in === 'query').map((row) => kv(row.name, row.value, row.enabled))
      const headers = params.filter((row) => row.in === 'header').map((row) => kv(row.name, row.value, row.enabled))
      const bodyNode = asObject(op.requestBody)
      const body = readBody(bodyNode?.content, root)
      const auth = Array.isArray(op.security) ? pickAuth(op.security, schemes, docAuth) : docAuth
      const req = importedRequest({
        name: operationName(method, path, op),
        method,
        url: toNiuMaPath(path),
        params: query,
        headers,
        auth,
        bodyMode: body.bodyMode,
        body: body.body,
        bodyForm: body.bodyForm,
      })
      const tag = firstTag(op) || ''
      const bucket = groups.get(tag) ?? []
      bucket.push(req)
      groups.set(tag, bucket)
    }
  }

  const rootRequests = groups.get('') ?? []
  dedupeRequestNames(rootRequests)
  const rootFolder = importedFolder(title, null, rootRequests, base ? { baseUrl: base } : {})
  const folders: ApiFolder[] = [rootFolder]
  for (const [tag, requests] of groups) {
    if (!tag) continue
    dedupeRequestNames(requests)
    folders.push(importedFolder(tag, rootFolder.id, requests))
  }
  return normalizeFolderGraph(folders)
}
