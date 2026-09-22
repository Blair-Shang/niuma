/**
 * API 协议面板注册表
 * ──────────────────────────────────────────────────────────────────────────
 * 对齐库模块 pane-registry（Vast / MySQL / Mongo）：
 *
 * - 集合树右键决定「能新建什么」→ creates 产出 method
 * - 请求 Tab 的 method 决定「打开的是哪个」→ paneKindOf
 * - ApiHome 只是页签壳，按 kind 查本表懒加载唯一面板
 *
 * 新协议：panes/{kind}.ts 导出 feature，并在 apiPaneRegistry 加一行。
 * 不要改 ApiHome，也不要再 register() 副作用。
 */
import { defineAsyncComponent, type Component } from 'vue'
import type { ApiMethod, ApiRequest } from './types'
import { httpFeature } from './panes/http'
import { socketFeature } from './panes/socket'
import type { ApiFeatureDef, ApiPaneCreateAction, ApiPaneCreateOpts, ApiPaneDescriptor, ApiPaneKind, ApiPaneScope } from './pane-types'

export type {
  ApiFeatureDef,
  ApiPaneContext,
  ApiPaneCreateAction,
  ApiPaneCreateOpts,
  ApiPaneDescriptor,
  ApiPaneKind,
  ApiPaneScope,
} from './pane-types'

/** apiPaneRegistry 按协议 kind 索引全部面板（ApiHome 的唯一分发依据）。 */
export const apiPaneRegistry: Record<ApiPaneKind, ApiFeatureDef> = {
  http: httpFeature,
  socket: socketFeature,
}

const FEATURE_SET = new Set<string>(Object.keys(apiPaneRegistry))

const methodKind = new Map<ApiMethod, ApiPaneKind>()
for (const kind of Object.keys(apiPaneRegistry) as ApiPaneKind[]) {
  for (const method of apiPaneRegistry[kind].methods) {
    methodKind.set(method, kind)
  }
}

const componentCache = new Map<string, Component>()

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
  return apiPaneRegistry[normalizeApiPaneKind(kind)].resolvePane(scope)
}

export function apiPaneComponent(kind: ApiPaneKind, scope: ApiPaneScope = {}): Component {
  const resolved = normalizeApiPaneKind(kind)
  const cacheKey = `${resolved}:${scope.listen ? 'listen' : 'dial'}`
  const cached = componentCache.get(cacheKey)
  if (cached) return cached
  const comp = defineAsyncComponent(resolveApiPane(resolved, scope).loader)
  componentCache.set(cacheKey, comp)
  return comp
}

/** 方法换面板时才套目标 kind 的默认地址 / 头，同面板内只改 method。 */
export function applyPaneMethod(req: ApiRequest, method: ApiMethod): void {
  const prev = paneKindOf(req.method)
  const next = paneKindOf(method)
  req.method = method
  if (prev !== next) {
    apiPaneRegistry[next].applyDefaults(req)
  }
}

export function applyPaneDefaults(req: ApiRequest, opts?: ApiPaneCreateOpts): void {
  apiPaneRegistry[paneKindOf(req.method)].applyDefaults(req, opts)
}

export function listApiPaneCreates(): ApiPaneCreateAction[] {
  const items: ApiPaneCreateAction[] = []
  for (const def of Object.values(apiPaneRegistry)) {
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
