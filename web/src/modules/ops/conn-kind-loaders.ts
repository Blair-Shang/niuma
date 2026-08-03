import type { ConnKind } from '@/modules/ops/types'

export type ConnKindLoader = () => Promise<void>

interface ConnKindLoaderEntry {
  /** 仅表单 adapter + 字段插槽（新建/编辑对话框） */
  loadForm: ConnKindLoader
  /** 完整注册：表单 + 导航 + 树等 */
  load: ConnKindLoader
  /** 该协议是否向连接树贡献可展开子节点（未加载前用于 isLeaf 判断） */
  tree: boolean
}

const loaders: Partial<Record<ConnKind, ConnKindLoaderEntry>> = {}
const formLoaded = new Set<ConnKind>()
const loaded = new Set<ConnKind>()
const formInflight = new Map<ConnKind, Promise<void>>()
const inflight = new Map<ConnKind, Promise<void>>()

/** 注册协议懒加载入口（启动时只登记，不拉取模块）。 */
export function registerConnKindLoader(kind: ConnKind, entry: ConnKindLoaderEntry): void {
  loaders[kind] = entry
}

/** 是否声明了连接树 Provider（含尚未加载）。 */
export function connKindHasTree(kind: string): boolean {
  return loaders[kind as ConnKind]?.tree === true
}

function runLoader(
  kind: ConnKind,
  map: Map<ConnKind, Promise<void>>,
  done: Set<ConnKind>,
  load: ConnKindLoader,
): Promise<void> {
  if (done.has(kind)) return Promise.resolve()
  const existing = map.get(kind)
  if (existing) return existing
  const task = load()
    .then(() => {
      done.add(kind)
    })
    .catch((err) => {
      map.delete(kind)
      throw err
    })
  map.set(kind, task)
  return task
}

/**
 * 仅确保表单可用（新建/编辑连接）。
 * loadForm chunk 内同步包含字段组件，完成后打开对话框不会因异步插槽二次撑高而跳动。
 */
export async function ensureConnKindForm(kind: ConnKind): Promise<void> {
  if (formLoaded.has(kind) || loaded.has(kind)) return
  const entry = loaders[kind]
  if (!entry) {
    throw new Error(`conn kind loader not registered: ${kind}`)
  }
  await runLoader(kind, formInflight, formLoaded, entry.loadForm)
}

/** 该协议完整注册是否已完成（树 Provider / 导航等可用）。 */
export function isConnKindLoaded(kind: ConnKind | string): boolean {
  return loaded.has(kind as ConnKind)
}

/** 按需加载并执行该协议的完整自注册（表单 / 导航 / 树等）。 */
export async function ensureConnKind(kind: ConnKind): Promise<void> {
  if (loaded.has(kind)) return
  const entry = loaders[kind]
  if (!entry) {
    throw new Error(`conn kind loader not registered: ${kind}`)
  }
  await runLoader(kind, inflight, loaded, entry.load)
  formLoaded.add(kind)
}

/**
 * 可选：空闲时预取表单 chunk。
 * 默认路径已改为按需 `ensureConnKindForm`（打开新建/编辑时），避免侧栏挂载即拉全协议。
 */
export function prefetchConnKindForms(kinds: readonly ConnKind[]): void {
  for (const kind of kinds) {
    void ensureConnKindForm(kind).catch(() => undefined)
  }
}
