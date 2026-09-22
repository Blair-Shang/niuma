/**
 * API 协议门面。
 * - 元数据 / 新建菜单：pane-catalog（同步，无 Vue）
 * - 工作台：ensureApiPane → 各目录 register()（对齐 ops ensureConnKind）
 */
import { defineAsyncComponent, type Component } from 'vue'
import { API_PANE_KIND_DEFS, apiPaneKindDef } from './pane-catalog'
import { ensureApiPane, getApiPaneRuntime } from './pane-kind-loaders'
import { registerBuiltinApiPaneLoaders } from './register-builtin-panes'
import type { ApiMethod, ApiRequest } from '../types'
import type { ApiPaneCreateAction, ApiPaneCreateOpts, ApiPaneDescriptor, ApiPaneKind, ApiPaneScope } from './pane-types'

export type {
  ApiFeatureDef,
  ApiPaneContext,
  ApiPaneCreateAction,
  ApiPaneCreateOpts,
  ApiPaneDescriptor,
  ApiPaneKind,
  ApiPaneKindDef,
  ApiPaneScope,
} from './pane-types'

export { API_PANE_KIND_DEFS, apiPaneKindDef } from './pane-catalog'

const FEATURE_SET = new Set<string>(API_PANE_KIND_DEFS.map((def) => def.kind))

const methodKind = new Map<ApiMethod, ApiPaneKind>()
for (const def of API_PANE_KIND_DEFS) {
  for (const method of def.methods) {
    methodKind.set(method, def.kind)
  }
}

const componentCache = new Map<string, Component>()

function ensureLoaders(): void {
  registerBuiltinApiPaneLoaders()
}

export function isApiPaneKind(value: string | undefined): value is ApiPaneKind {
  return !!value && FEATURE_SET.has(value)
}

export function normalizeApiPaneKind(kind: string | undefined): ApiPaneKind {
  return isApiPaneKind(kind) ? kind : 'http'
}

export function paneKindOf(method: ApiMethod): ApiPaneKind {
  return methodKind.get(method) ?? 'http'
}

export function resolveApiPane(kind: ApiPaneKind, scope: ApiPaneScope = {}): ApiPaneDescriptor {
  return getApiPaneRuntime(normalizeApiPaneKind(kind)).resolvePane(scope)
}

export function apiPaneComponent(kind: ApiPaneKind, scope: ApiPaneScope = {}): Component {
  ensureLoaders()
  const resolved = normalizeApiPaneKind(kind)
  const cacheKey = `${resolved}:${scope.listen ? 'listen' : 'dial'}`
  const cached = componentCache.get(cacheKey)
  if (cached) return cached
  const comp = defineAsyncComponent(async () => {
    await ensureApiPane(resolved)
    return resolveApiPane(resolved, scope).loader()
  })
  componentCache.set(cacheKey, comp)
  return comp
}

/** 方法换面板时才套目标 kind 的默认地址 / 头，同面板内只改 method。 */
export function applyPaneMethod(req: ApiRequest, method: ApiMethod): void {
  const prev = paneKindOf(req.method)
  const next = paneKindOf(method)
  req.method = method
  if (prev !== next) {
    apiPaneKindDef(next).applyDefaults(req)
  }
}

export function applyPaneDefaults(req: ApiRequest, opts?: ApiPaneCreateOpts): void {
  apiPaneKindDef(paneKindOf(req.method)).applyDefaults(req, opts)
}

export function listApiPaneCreates(): ApiPaneCreateAction[] {
  const items: ApiPaneCreateAction[] = []
  for (const def of API_PANE_KIND_DEFS) {
    if (def.creates) items.push(...def.creates)
  }
  return items
}

export function paneCreateKey(item: ApiPaneCreateAction): string {
  return item.listen ? `new-pane:${item.method}:listen` : `new-pane:${item.method}`
}

export function findPaneCreate(key: string): ApiPaneCreateAction | undefined {
  const walk = (items: readonly ApiPaneCreateAction[]): ApiPaneCreateAction | undefined => {
    for (const item of items) {
      if (item.children?.length) {
        const hit = walk(item.children)
        if (hit) return hit
        continue
      }
      if (paneCreateKey(item) === key) return item
    }
    return undefined
  }
  return walk(listApiPaneCreates())
}
