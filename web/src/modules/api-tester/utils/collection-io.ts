/**
 * 集合 / 工作区信封：解析、序列化、id remint。
 * 读盘只认 kind 和字段，不按 version 拒收。写出是当前结构：环境与变量不进 workspace JSON。
 */
import { createId } from '@/utils/id'
import { newKvRow } from './format'
import { normalizeFolderGraph } from './folder-tree'
import type {
  ApiAuth,
  ApiAuthType,
  ApiBodyMode,
  ApiEnvironment,
  ApiFolder,
  ApiKvRow,
  ApiMethod,
  ApiMockRoute,
  ApiMockServer,
  ApiRequest,
  ApiRunProfile,
  ApiVariableBag,
  ApiVariableKind,
} from '../types'

export const COLLECTION_KIND = 'niuma.api-collection'
export const WORKSPACE_KIND = 'niuma.api-workspace'

const METHODS = new Set<ApiMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'WS', 'TCP', 'UDP'])
const AUTH_TYPES = new Set<ApiAuthType>(['none', 'bearer', 'basic', 'apikey'])
const BODY_MODES = new Set<ApiBodyMode>(['none', 'raw', 'json', 'text', 'urlencoded', 'form'])

/** 集合导出信封。不含环境 Token / 密码，也不含发送历史。 */
export interface ApiCollectionFile {
  kind: typeof COLLECTION_KIND
  exportedAt: string
  folders: ApiFolder[]
}

export interface ApiWorkspaceExtras {
  globals?: ApiVariableBag
  runProfiles?: ApiRunProfile[]
  mockServers?: ApiMockServer[]
}

/**
 * 本机工作区。写出只含集合结构与 envId。
 * environments / globals 只在读到旧快照时出现，供 catalog 为空时迁入关系表。
 */
export interface ApiWorkspaceState {
  kind: typeof WORKSPACE_KIND
  folders: ApiFolder[]
  envId: string
  runProfiles?: ApiRunProfile[]
  mockServers?: ApiMockServer[]
  environments?: ApiEnvironment[]
  globals?: ApiVariableBag
}

export function defaultAuth(): ApiAuth {
  return { type: 'none' }
}

export function emptyVars(): Record<string, string> {
  return {}
}

export function emptyKinds(): Record<string, ApiVariableKind> {
  return {}
}

/** 解析 JSON 中的 bodyMode；缺省或非法则 null。 */
export function parseBodyMode(raw: unknown): ApiBodyMode | null {
  if (typeof raw !== 'string' || !BODY_MODES.has(raw as ApiBodyMode)) return null
  return raw as ApiBodyMode
}

export function cloneKvRows(rows: ApiKvRow[]): ApiKvRow[] {
  return rows.map((row) => ({ ...row, id: createId('kv') }))
}

/** 复制 auth；不用 structuredClone，避免 Vue reactive Proxy 触发 DataCloneError。 */
function cloneAuth(auth: ApiAuth): ApiAuth {
  const out: ApiAuth = { type: auth.type }
  if (auth.bearer) out.bearer = { ...auth.bearer }
  if (auth.basic) out.basic = { ...auth.basic }
  if (auth.apiKey) out.apiKey = { ...auth.apiKey }
  return out
}

/** 序列化/合并用：把 reactive 请求收成 plain 对象。 */
function cloneRequestPlain(req: ApiRequest): ApiRequest {
  return {
    id: req.id,
    name: req.name,
    method: req.method,
    url: req.url,
    params: req.params.map((row) => ({ ...row })),
    headers: req.headers.map((row) => ({ ...row })),
    auth: cloneAuth(req.auth),
    bodyMode: req.bodyMode,
    body: req.body,
    bodyForm: (req.bodyForm ?? []).map((row) => ({ ...row })),
  }
}

export function cloneRequest(req: ApiRequest, name = req.name): ApiRequest {
  return {
    ...req,
    id: createId('req'),
    name,
    auth: cloneAuth(req.auth),
    params: cloneKvRows(req.params),
    headers: cloneKvRows(req.headers),
    bodyForm: cloneKvRows(req.bodyForm ?? []),
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asMethod(value: unknown): ApiMethod {
  return METHODS.has(value as ApiMethod) ? (value as ApiMethod) : 'GET'
}

function asAuthType(value: unknown): ApiAuthType {
  return AUTH_TYPES.has(value as ApiAuthType) ? (value as ApiAuthType) : 'none'
}

function asVars(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return emptyVars()
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

function asVariableBag(raw: unknown): ApiVariableBag {
  if (!raw || typeof raw !== 'object') return { vars: emptyVars(), kinds: emptyKinds() }
  const item = raw as Record<string, unknown>
  return { vars: asVars(item.vars ?? item), kinds: emptyKinds() }
}

export function asAuth(raw: unknown): ApiAuth {
  if (!raw || typeof raw !== 'object') return defaultAuth()
  const item = raw as Record<string, unknown>
  const type = asAuthType(item.type)
  const auth: ApiAuth = { type }
  if (type === 'bearer' && item.bearer && typeof item.bearer === 'object') {
    const bearer = item.bearer as Record<string, unknown>
    auth.bearer = { token: asText(bearer.token) }
  }
  if (type === 'basic' && item.basic && typeof item.basic === 'object') {
    const basic = item.basic as Record<string, unknown>
    auth.basic = { username: asText(basic.username), password: asText(basic.password) }
  }
  if (type === 'apikey' && item.apiKey && typeof item.apiKey === 'object') {
    const apiKey = item.apiKey as Record<string, unknown>
    auth.apiKey = {
      key: asText(apiKey.key),
      value: asText(apiKey.value),
      in: apiKey.in === 'query' ? 'query' : 'header',
    }
  }
  return auth
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
  const bodyMode = parseBodyMode(item.bodyMode) ?? 'none'
  const auth = item.auth && typeof item.auth === 'object' ? asAuth(item.auth) : defaultAuth()
  const kept = asText(item.id).trim()
  return {
    id: remintId || !kept ? createId('req') : kept,
    name,
    method: asMethod(item.method),
    url: asText(item.url),
    params: asKvRows(item.params),
    headers: asKvRows(item.headers),
    auth,
    bodyMode,
    body: asText(item.body),
    bodyForm: asKvRows(item.bodyForm),
  }
}

function asFolder(raw: unknown): ApiFolder | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const name = asText(item.name).trim()
  if (!name) return null
  const kept = asText(item.id).trim()
  const parentId =
    'parentId' in item ? (item.parentId === null ? null : asText(item.parentId).trim() || null) : null
  const requests = Array.isArray(item.requests)
    ? item.requests.map((row) => asRequest(row, false)).filter((req): req is ApiRequest => req !== null)
    : []
  return {
    id: kept || createId('folder'),
    name,
    parentId,
    vars: 'vars' in item ? asVars(item.vars) : emptyVars(),
    requests,
  }
}

/** 导入时重发 id，并按旧 id 重写 parentId，避免子文件夹全部掉到根。 */
function remintFolderIds(folders: ApiFolder[]): void {
  const idMap = new Map<string, string>()
  for (const folder of folders) {
    const next = createId('folder')
    idMap.set(folder.id, next)
    folder.id = next
  }
  for (const folder of folders) {
    if (folder.parentId) {
      folder.parentId = idMap.get(folder.parentId) ?? null
    }
    for (const req of folder.requests) {
      req.id = createId('req')
    }
  }
}

/** 解析文件夹列表：可选 remint，最后掰断坏 parentId。 */
function readFolders(rawFolders: unknown[], remintId: boolean): ApiFolder[] {
  const folders = rawFolders
    .map((row) => asFolder(row))
    .filter((folder): folder is ApiFolder => folder !== null)
  if (remintId) remintFolderIds(folders)
  return normalizeFolderGraph(folders)
}

/** hydrate 竞态：磁盘快照里尚未出现在 live 的文件夹/请求补回。 */
export function mergeWorkspaceFolders(live: ApiFolder[], disk: readonly ApiFolder[]): void {
  const liveRequestIds = new Set<string>()
  for (const folder of live) {
    for (const req of folder.requests) liveRequestIds.add(req.id)
  }
  for (const diskFolder of disk) {
    let target = live.find((folder) => folder.id === diskFolder.id)
    if (!target) {
      live.push({
        id: diskFolder.id,
        name: diskFolder.name,
        parentId: diskFolder.parentId,
        vars: { ...diskFolder.vars },
        requests: diskFolder.requests.map((req) => cloneRequestPlain(req)),
      })
      for (const req of diskFolder.requests) liveRequestIds.add(req.id)
      continue
    }
    for (const req of diskFolder.requests) {
      if (liveRequestIds.has(req.id)) continue
      target.requests.push(cloneRequestPlain(req))
      liveRequestIds.add(req.id)
    }
  }
}

function asEnvironment(raw: unknown): ApiEnvironment | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const name = asText(item.name).trim()
  if (!name) return null
  const baseUrl = asText(item.baseUrl).trim()
  const vars = 'vars' in item ? asVars(item.vars) : emptyVars()
  if (baseUrl && !vars.baseUrl) vars.baseUrl = baseUrl
  return {
    id: asText(item.id).trim() || createId('env'),
    name,
    baseUrl,
    vars,
    kinds: emptyKinds(),
  }
}

function asRunProfiles(raw: unknown): ApiRunProfile[] {
  if (!Array.isArray(raw)) return []
  const out: ApiRunProfile[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const name = asText(item.name).trim()
    if (!name) continue
    const kind = item.kind
    const targetKind = kind === 'folder' || kind === 'request' ? kind : 'collection'
    out.push({
      id: asText(item.id).trim() || createId('run'),
      name,
      kind: targetKind,
      targetIds: Array.isArray(item.targetIds) ? item.targetIds.map((id) => asText(id)).filter(Boolean) : [],
      concurrency: typeof item.concurrency === 'number' ? item.concurrency : 1,
      iterations: typeof item.iterations === 'number' ? item.iterations : 1,
      rampUpMs: typeof item.rampUpMs === 'number' ? item.rampUpMs : undefined,
      thinkTimeMs: typeof item.thinkTimeMs === 'number' ? item.thinkTimeMs : undefined,
      envId: asText(item.envId).trim() || undefined,
      enabled: item.enabled === true,
    })
  }
  return out
}

function asMockServers(raw: unknown): ApiMockServer[] {
  if (!Array.isArray(raw)) return []
  const out: ApiMockServer[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const name = asText(item.name).trim()
    if (!name) continue
    const routesRaw = Array.isArray(item.routes) ? item.routes : []
    const routes: ApiMockRoute[] = []
    for (const routeRow of routesRaw) {
      if (!routeRow || typeof routeRow !== 'object') continue
      const route = routeRow as Record<string, unknown>
      const routeName = asText(route.name).trim() || asText(route.path).trim()
      if (!routeName) continue
      routes.push({
        id: asText(route.id).trim() || createId('mock-route'),
        name: routeName,
        method: asMethod(route.method),
        path: asText(route.path),
        match: route.match === 'prefix' || route.match === 'param' ? route.match : 'exact',
        status: typeof route.status === 'number' ? route.status : 200,
        statusText: asText(route.statusText).trim() || undefined,
        headers: asKvRows(route.headers),
        body: asText(route.body),
        bodyMode: parseBodyMode(route.bodyMode) ?? 'none',
        delayMs: typeof route.delayMs === 'number' ? route.delayMs : undefined,
        sourceRequestId: asText(route.sourceRequestId).trim() || undefined,
      })
    }
    out.push({
      id: asText(item.id).trim() || createId('mock'),
      name,
      enabled: item.enabled === true,
      host: asText(item.host).trim() || '127.0.0.1',
      port: typeof item.port === 'number' ? item.port : 0,
      routes,
    })
  }
  return out
}

export function serializeCollection(folders: ApiFolder[]): ApiCollectionFile {
  return {
    kind: COLLECTION_KIND,
    exportedAt: new Date().toISOString(),
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      vars: { ...folder.vars },
      requests: folder.requests.map((req) => cloneRequestPlain(req)),
    })),
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
  const folders = readFolders(rawFolders, true)
  if (folders.length === 0 && rawFolders.length > 0) return { error: 'invalid' }
  return { folders }
}

export function serializeWorkspace(
  folders: ApiFolder[],
  envId: string,
  extras: ApiWorkspaceExtras = {},
): ApiWorkspaceState {
  return {
    kind: WORKSPACE_KIND,
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      vars: emptyVars(),
      requests: folder.requests.map((req) => cloneRequestPlain(req)),
    })),
    envId,
    runProfiles: extras.runProfiles ?? [],
    mockServers: extras.mockServers ?? [],
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
  const folders = readFolders(rawFolders, false)
  if (rawFolders.length > 0 && folders.length === 0) return null
  const environments = Array.isArray(root.environments)
    ? root.environments.map(asEnvironment).filter((env): env is ApiEnvironment => env !== null)
    : []
  const globals = root.globals ? asVariableBag(root.globals) : undefined
  return {
    kind: WORKSPACE_KIND,
    folders,
    envId: asText(root.envId).trim(),
    runProfiles: asRunProfiles(root.runProfiles),
    mockServers: asMockServers(root.mockServers),
    environments: environments.length > 0 ? environments : undefined,
    globals: globals && Object.keys(globals.vars).length > 0 ? globals : undefined,
  }
}

/** kind 已是工作区，但文件夹一条都没解析出来。调用方不得用空种子覆盖这份磁盘。 */
export function isApiWorkspaceText(text: string | null | undefined): boolean {
  if (!text) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object') return false
  return (parsed as Record<string, unknown>).kind === WORKSPACE_KIND
}

/** 旧快照仍把环境或变量写在 JSON 里。 */
export function workspaceHasEmbeddedCatalog(state: ApiWorkspaceState): boolean {
  if (state.environments?.length) return true
  if (state.globals && Object.keys(state.globals.vars).length > 0) return true
  return state.folders.some((folder) => Object.keys(folder.vars).length > 0)
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
  const baseUrl = '127.0.0.1:9000'
  return [{ id: 'local', name: 'Local', baseUrl, vars: { baseUrl }, kinds: emptyKinds() }]
}

/** 空工作区只放一个默认文件夹，不预置示例请求。 */
export function defaultFolders(name: string): ApiFolder[] {
  const trimmed = name.trim() || 'Drafts'
  return [{ id: 'drafts', name: trimmed, parentId: null, vars: emptyVars(), requests: [] }]
}

export function uniqueName(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) return base
  let index = 1
  while (existing.includes(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

export function fileSlug(name: string): string {
  const slug = name
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 40)
  return slug || 'collection'
}

/** 测试与 spec 用的最小请求形状。 */
export function minimalRequest(partial: Partial<ApiRequest> = {}): ApiRequest {
  const body = partial.body ?? ''
  return {
    id: 'req-test',
    name: 'Test',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: defaultAuth(),
    bodyMode: partial.bodyMode ?? 'none',
    body,
    bodyForm: [],
    ...partial,
  }
}
