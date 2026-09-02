import { newKvRow } from './format'
import type { ApiEnvironment, ApiFolder, ApiKvRow, ApiMethod, ApiRequest } from '../types'

export const COLLECTION_KIND = 'niuma.api-collection'
export const COLLECTION_VERSION = 1
export const WORKSPACE_KIND = 'niuma.api-workspace'
export const WORKSPACE_VERSION = 1

const METHODS: readonly ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'WS', 'TCP', 'UDP']

/** 集合导出信封。不含环境 Token / 密码，也不含发送历史。 */
export interface ApiCollectionFile {
  kind: typeof COLLECTION_KIND
  version: number
  exportedAt: string
  folders: ApiFolder[]
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function cloneKvRows(rows: ApiKvRow[]): ApiKvRow[] {
  return rows.map((row) => ({ ...row, id: newId('kv') }))
}

export function cloneRequest(req: ApiRequest, name = req.name): ApiRequest {
  return {
    ...req,
    id: newId('req'),
    name,
    params: cloneKvRows(req.params),
    headers: cloneKvRows(req.headers),
  }
}

export function serializeCollection(folders: ApiFolder[]): ApiCollectionFile {
  return {
    kind: COLLECTION_KIND,
    version: COLLECTION_VERSION,
    exportedAt: new Date().toISOString(),
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      requests: folder.requests.map((req) => ({ ...req })),
    })),
  }
}

function asMethod(value: unknown): ApiMethod {
  return METHODS.includes(value as ApiMethod) ? (value as ApiMethod) : 'GET'
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asKvRows(raw: unknown): ApiKvRow[] {
  if (!Array.isArray(raw)) return []
  return raw.map((row) => {
    const item = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    return newKvRow(asText(item.key), asText(item.value), item.enabled !== false)
  })
}

function asRequest(raw: unknown, remintId: boolean): ApiRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const name = asText(item.name).trim()
  if (!name) return null
  const kept = asText(item.id).trim()
  return {
    id: remintId || !kept ? newId('req') : kept,
    name,
    method: asMethod(item.method),
    url: asText(item.url),
    params: asKvRows(item.params),
    headers: asKvRows(item.headers),
    body: asText(item.body),
  }
}

function asFolder(raw: unknown, remintId: boolean): ApiFolder | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const name = asText(item.name).trim()
  if (!name) return null
  const kept = asText(item.id).trim()
  const requests = Array.isArray(item.requests)
    ? item.requests.map((row) => asRequest(row, remintId)).filter((req): req is ApiRequest => req !== null)
    : []
  return { id: remintId || !kept ? newId('folder') : kept, name, requests }
}

function asEnvironment(raw: unknown): ApiEnvironment | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const name = asText(item.name).trim()
  if (!name) return null
  return {
    id: asText(item.id).trim() || newId('env'),
    name,
    baseUrl: asText(item.baseUrl),
  }
}

export function parseCollection(text: string): { folders: ApiFolder[] } | { error: 'invalid' | 'kind' } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { error: 'invalid' }
  }
  if (!parsed || typeof parsed !== 'object') return { error: 'invalid' }
  const root = parsed as Record<string, unknown>
  if (root.kind !== COLLECTION_KIND) return { error: 'kind' }
  const rawFolders = Array.isArray(root.folders) ? root.folders : []
  const folders = rawFolders
    .map((row) => asFolder(row, true))
    .filter((folder): folder is ApiFolder => folder !== null)
  if (folders.length === 0 && rawFolders.length > 0) return { error: 'invalid' }
  return { folders }
}

/** 本机工作区快照。保留 id，重启后 Tab 还能对上请求。 */
export interface ApiWorkspaceState {
  kind: typeof WORKSPACE_KIND
  version: number
  folders: ApiFolder[]
  environments: ApiEnvironment[]
  envId: string
}

export function serializeWorkspace(
  folders: ApiFolder[],
  environments: ApiEnvironment[],
  envId: string,
): ApiWorkspaceState {
  return {
    kind: WORKSPACE_KIND,
    version: WORKSPACE_VERSION,
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      requests: folder.requests.map((req) => ({ ...req })),
    })),
    environments: environments.map((env) => ({ ...env })),
    envId,
  }
}

export function parseWorkspace(text: string | null | undefined): ApiWorkspaceState | null {
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const root = parsed as Record<string, unknown>
  if (root.kind !== WORKSPACE_KIND) return null
  const rawFolders = Array.isArray(root.folders) ? root.folders : []
  const folders = rawFolders
    .map((row) => asFolder(row, false))
    .filter((folder): folder is ApiFolder => folder !== null)
  const rawEnvs = Array.isArray(root.environments) ? root.environments : []
  const environments = rawEnvs
    .map(asEnvironment)
    .filter((env): env is ApiEnvironment => env !== null)
  const envId = asText(root.envId).trim()
  return { kind: WORKSPACE_KIND, version: WORKSPACE_VERSION, folders, environments, envId }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function pickJsonFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        void file.text().then(resolve, () => resolve(null))
      },
      { once: true },
    )
    input.click()
  })
}

export function defaultEnvironments(): ApiEnvironment[] {
  return [{ id: 'local', name: 'Local', baseUrl: '127.0.0.1:9000' }]
}

/** 空工作区只放一个默认文件夹，不预置示例请求。 */
export function defaultFolders(name: string): ApiFolder[] {
  const trimmed = name.trim() || 'Drafts'
  return [{ id: 'drafts', name: trimmed, requests: [] }]
}

export function uniqueName(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) return base
  let index = 1
  while (existing.includes(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

export function uniqueFolderName(base: string, existing: readonly string[]): string {
  return uniqueName(base, existing)
}

export function fileSlug(name: string): string {
  const slug = name
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 40)
  return slug || 'collection'
}
