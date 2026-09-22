/**
 * API 协议懒加载。对齐 ops/conn-kind-loaders：
 * 启动只 registerApiPaneLoader；打开工作台才 ensureApiPane → register()。
 */
import type { ApiPaneKind, ApiPaneRuntime } from './pane-types'

export type ApiPaneLoader = () => Promise<void>

const loaders: Partial<Record<ApiPaneKind, ApiPaneLoader>> = {}
const loaded = new Set<ApiPaneKind>()
const inflight = new Map<ApiPaneKind, Promise<void>>()
const runtimes = new Map<ApiPaneKind, ApiPaneRuntime>()

/** 登记协议懒加载入口（启动时只登记，不拉取模块）。 */
export function registerApiPaneLoader(kind: ApiPaneKind, load: ApiPaneLoader): void {
  loaders[kind] = load
}

/** 协议 register() 写入运行时（resolvePane）。 */
export function registerApiPaneFeature(kind: ApiPaneKind, runtime: ApiPaneRuntime): void {
  runtimes.set(kind, runtime)
}

export function isApiPaneLoaded(kind: ApiPaneKind): boolean {
  return loaded.has(kind)
}

export function getApiPaneRuntime(kind: ApiPaneKind): ApiPaneRuntime {
  const runtime = runtimes.get(kind)
  if (!runtime) throw new Error(`api pane not registered: ${kind}`)
  return runtime
}

function runLoader(kind: ApiPaneKind, load: ApiPaneLoader): Promise<void> {
  if (loaded.has(kind)) return Promise.resolve()
  const existing = inflight.get(kind)
  if (existing) return existing
  const task = load()
    .then(() => {
      loaded.add(kind)
    })
    .catch((error) => {
      inflight.delete(kind)
      throw error
    })
  inflight.set(kind, task)
  return task
}

/** 按需加载并执行该协议 register()。 */
export async function ensureApiPane(kind: ApiPaneKind): Promise<void> {
  if (loaded.has(kind)) return
  const load = loaders[kind]
  if (!load) throw new Error(`api pane loader not registered: ${kind}`)
  await runLoader(kind, load)
}
