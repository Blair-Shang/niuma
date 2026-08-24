import type { RsTreeNode } from '@niuma/ui'
import { shallowRef } from 'vue'
import type { ConnResourceDescriptor, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { connMetadataCache } from '@/modules/ops/conn-tree/metadata-cache'
import { ensureConnKind } from '@/modules/ops/conn-kind-loaders'
import { getConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import {
  connTreeKey,
  parseConnTreeKey,
  resourceTreeKey,
} from '@/modules/ops/conn-tree/keys'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnLeafNode, ConnResourceNode, ConnTreeNode } from '@/modules/ops/composables/useConnTree'

function descriptorToNode(conn: ConnItem, descriptor: ConnResourceDescriptor): ConnResourceNode {
  const searchText = `${descriptor.label} ${descriptor.badge ?? ''}`.trim().toLowerCase()
  return {
    key: resourceTreeKey(conn.profileId, descriptor.path),
    label: descriptor.label,
    isLeaf: !descriptor.collapsible,
    children: descriptor.collapsible ? [] : undefined,
    _type: 'resource',
    _conn: conn,
    _path: descriptor.path,
    _searchText: searchText,
    _badge: descriptor.badge,
    _icon: descriptor.icon,
  }
}

const EMPTY_CHILD_CACHE: ReadonlyMap<string, ConnResourceNode[]> = new Map()
const EMPTY_LOADING_SET: ReadonlySet<string> = new Set()

function applyChildCache(
  nodes: readonly ConnTreeNode[],
  cache?: ReadonlyMap<string, ConnResourceNode[]>,
  loadingSet?: ReadonlySet<string>,
  visiting: Set<string> = new Set(),
): ConnTreeNode[] {
  const cacheMap = cache ?? EMPTY_CHILD_CACHE
  const loadingKeysSet = loadingSet ?? EMPTY_LOADING_SET
  return nodes.map((node) => {
    const key = node.key
    const loading = Boolean(key && loadingKeysSet.has(key))
    if (!key) {
      return node
    }

    // 缓存图成环（或父子误指向同一 children 数组）时防止栈溢出
    if (visiting.has(key)) {
      return {
        ...node,
        isLeaf: true,
        children: undefined,
        loading,
      }
    }

    const cached = cacheMap.get(key)
    if (cached) {
      // 叶子节点不应拥有子列表（误刷新表/视图时曾把兄弟挂到叶子下）
      if (node.isLeaf) {
        return { ...node, children: undefined, isLeaf: true, loading }
      }
      visiting.add(key)
      try {
        return {
          ...node,
          isLeaf: false,
          children: applyChildCache(cached, cacheMap, loadingKeysSet, visiting),
          loading,
        }
      } finally {
        visiting.delete(key)
      }
    }

    const children = node.children as ConnTreeNode[] | undefined
    if (children?.length) {
      visiting.add(key)
      try {
        return {
          ...node,
          children: applyChildCache(children, cacheMap, loadingKeysSet, visiting),
          loading,
        }
      } finally {
        visiting.delete(key)
      }
    }

    // 勿把 cache 内对象直接交给树：避免 RsTree / 业务侧就地改 children 污染单例缓存
    return { ...node, loading }
  })
}

function cacheKey(conn: ConnItem, parentPath?: ConnResourceDescriptor['path']): string {
  const tail = parentPath?.segments.map((s) => `${s.kind}:${s.name}`).join('/') ?? 'root'
  return `${conn.kind}:children:${conn.profileId}:${tail}`
}

/**
 * 子节点展示缓存（模块单例，与 `connMetadataCache` 同级）。
 *
 * ## 为何单例、以及和「连接改名」的对比
 * - 连接叶节点 label 直接从响应式 `allProfiles` 派生，改名后无需额外失效。
 * - 库 / schema / 表等是懒加载结果，存在本 Map；DDL（truncate/drop 等）成功后
 *   须调用 `invalidateConnTreeChildren`，由协议侧触发，而不是在 OpsConnectionPanel 挂业务 watch。
 *
 * ## 性能 / 内存（相对此前「Panel 实例内 shallowRef」）
 * - **不额外占一份业务数据**：结构仍是「树 key → 子节点数组」一张 Map；与实例版生命周期内占用同量级。
 * - **可能略省 CPU**：Panel 热重载 / 重建时不再丢掉已展开子树，可少打几次 `loadChildren`。
 * - **进程内常驻**：单例随页面存活，侧栏卸载后缓存仍保留到下次 `invalidate`；若需释放可主动
 *   `invalidateConnTreeChildren()`。metadata 层另有 TTL（约 15s）约束重复 RPC。
 * - **仍用 `shallowRef`**：只追踪 Map 引用；不对节点做深层 reactive，避免海量对象树上的
 *   Proxy 开销与 `displayNodes` 中 spread 触发无限递归。
 * - **失效成本**：无参整表替换为 O(1)；按 profile 扫描 Map 为 O(已缓存父节点数)，
 *   metadata 前缀清理为 O(缓存条目数)，通常远小于一次对象树 RPC。
 * - **多协议**：单例共享 ≠ 数据混用；见 `invalidateConnTreeChildren` 注释。
 */
const childCache = shallowRef(new Map<string, ConnResourceNode[]>())
/** 正在刷新的树节点 key；写入节点 `loading`，复用 RsTree 展开箭头转圈。 */
const loadingKeys = shallowRef(new Set<string>())
const loadingCounts = new Map<string, number>()

function markNodeLoading(key: string, on: boolean): void {
  const current = loadingCounts.get(key) ?? 0
  const nextCount = on ? current + 1 : Math.max(0, current - 1)
  if (nextCount <= 0) loadingCounts.delete(key)
  else loadingCounts.set(key, nextCount)
  loadingKeys.value = new Set(loadingCounts.keys())
}

async function withNodeLoading(key: string, task: () => Promise<void>): Promise<void> {
  markNodeLoading(key, true)
  try {
    await task()
  } finally {
    markNodeLoading(key, false)
  }
}

/**
 * 失效对象子树缓存。
 *
 * - 有 `profileId`：只删该连接相关的展示条目与 metadata（`${kind}:children:${profileId}:…`），
 *   其他协议 / 其他站点的已展开缓存保留，避免 MySQL / Oracle / Vastbase 共单例时互相误伤。
 * - 无参：全量清空（断开侧栏、全局重置场景）。
 *
 * ## 多协议安全性
 * - **不会错挂数据**：加载始终走 `getConnTreeProvider(conn.kind)`，节点带 `_conn`；
 *   metadata 键含 `kind` + `profileId`（见 `cacheKey`）。
 * - **树 UI 键**为 `conn:{profileId}` / `res:{profileId}:…`（profileId 全局唯一即可）；
 *   与是否 MySQL/Oracle 无关，单例共享不等于串库。
 */
export function invalidateConnTreeChildren(profileId?: string): void {
  if (!profileId) {
    childCache.value = new Map()
    loadingCounts.clear()
    loadingKeys.value = new Set()
    connMetadataCache.invalidate()
    return
  }

  const next = new Map(childCache.value)
  for (const key of next.keys()) {
    // conn:{id} | res:{id}:…
    if (key === `conn:${profileId}` || key.startsWith(`res:${profileId}:`)) {
      next.delete(key)
    }
  }
  childCache.value = next
  // cacheKey 形如 vastbase:children:{profileId}:root —— 用 :{id}: 匹配，不碰其他站点
  connMetadataCache.invalidate(`:${profileId}:`)
}

function displayNodes(base: readonly ConnTreeNode[]): ConnTreeNode[] {
  return applyChildCache(base, childCache.value ?? EMPTY_CHILD_CACHE, loadingKeys.value ?? EMPTY_LOADING_SET)
}

/** 路径尾部仅标识对象本身、从未作为可展开文件夹出现的 kind。 */
const PATH_LEAF_KINDS = new Set([
  'table',
  'function',
  'procedure',
  'sequence',
  'synonym',
  'collection',
  'oid',
  'args',
  'reltype',
  'hint',
  'db',
])

function syntheticResourceNode(conn: ConnItem, path: ConnResourcePath): ConnResourceNode {
  const last = path.segments.at(-1)
  return {
    key: resourceTreeKey(conn.profileId, path),
    label: last?.name ?? '',
    isLeaf: false,
    children: [],
    _type: 'resource',
    _conn: conn,
    _path: path,
    _searchText: (last?.name ?? '').toLowerCase(),
  }
}

/**
 * 解析叶子资源刷新时应重拉的父节点。
 * 路径里可能夹着仅作编码的段（如 vastbase 的 reltype），故优先找已缓存的祖先，
 * 再回退到剥掉尾部叶子段后的结构父路径；若无资源父级则回到连接根。
 */
function resolveLeafRefreshTarget(
  node: ConnResourceNode,
): { key: string; node: ConnTreeNode } | null {
  const segs = node._path.segments
  const profileId = node._conn.profileId

  for (let len = segs.length - 1; len >= 1; len--) {
    const parentPath: ConnResourcePath = { segments: segs.slice(0, len) }
    const parentKey = resourceTreeKey(profileId, parentPath)
    if (childCache.value.has(parentKey)) {
      return { key: parentKey, node: syntheticResourceNode(node._conn, parentPath) }
    }
  }

  // 无已缓存祖先：剥掉尾部对象段，落到 category / database 等容器
  let end = segs.length
  while (end > 0 && PATH_LEAF_KINDS.has(segs[end - 1].kind)) {
    end--
  }
  if (end <= 0) {
    const connKey = connTreeKey(profileId)
    return {
      key: connKey,
      node: {
        key: connKey,
        label: node._conn.profileName,
        isLeaf: false,
        children: [],
        _type: 'conn',
        _conn: node._conn,
        _searchText: '',
      },
    }
  }
  if (end === segs.length) {
    end = segs.length - 1
  }
  if (end <= 0) {
    return null
  }
  const parentPath: ConnResourcePath = { segments: segs.slice(0, end) }
  const parentKey = resourceTreeKey(profileId, parentPath)
  return { key: parentKey, node: syntheticResourceNode(node._conn, parentPath) }
}

async function loadChildrenForKey(key: string, node: RsTreeNode): Promise<void> {
  const parsed = parseConnTreeKey(key)
  if (parsed.type === 'conn') {
    const conn = (node as ConnLeafNode)._conn
    await ensureConnKind(conn.kind)
    const provider = getConnTreeProvider(conn.kind)
    if (!provider?.canExpand(conn)) {
      return
    }
    const descriptors = await connMetadataCache.fetch(cacheKey(conn), () =>
      provider.loadChildren(conn),
    )
    childCache.value = new Map(childCache.value).set(key, descriptors.map((d) => descriptorToNode(conn, d)))
    return
  }
  if (parsed.type === 'res') {
    const resource = node as ConnResourceNode
    // 表 / 视图 / 集合等叶子没有子节点；禁止把兄弟列表挂到叶子 key 下
    if (resource.isLeaf) {
      return
    }
    await ensureConnKind(resource._conn.kind)
    const provider = getConnTreeProvider(resource._conn.kind)
    if (!provider) {
      return
    }
    const descriptors = await connMetadataCache.fetch(cacheKey(resource._conn, resource._path), () =>
      provider.loadChildren(resource._conn, resource._path),
    )
    childCache.value = new Map(childCache.value).set(key, descriptors.map((d) => descriptorToNode(resource._conn, d)))
  }
}

async function loadData(node: RsTreeNode, key: string): Promise<void> {
  if (childCache.value.has(key)) {
    return
  }
  await loadChildrenForKey(key, node)
}

function isLoaded(key: string): boolean {
  return childCache.value.has(key)
}

/**
 * 强制刷新单个节点的子列表：清除该节点对应的 metadata 缓存条目后重新拉取。
 * 刷新期间给节点打 `loading`，RsTree 在展开箭头上显示转圈（与首次懒加载同一套样式）。
 *
 * 叶子资源（表 / 视图 / 集合等）无子节点：改为刷新其父容器的子列表，
 * 避免 loadChildren(叶子 path) 把整表/视图列表错误挂到该叶子下。
 */
async function refreshNode(key: string, node: RsTreeNode): Promise<void> {
  const n = node as ConnTreeNode
  if (n._type === 'resource' && n.isLeaf) {
    const target = resolveLeafRefreshTarget(n)
    // 清掉叶子上可能已误挂的子缓存
    if (childCache.value.has(key)) {
      const cleaned = new Map(childCache.value)
      cleaned.delete(key)
      childCache.value = cleaned
    }
    // 无 filter 后缀的前缀可匹配 `:f:` 变体（metadata-cache 用 includes）
    connMetadataCache.invalidate(cacheKey(n._conn, n._path))
    if (target) {
      await refreshNode(target.key, target.node)
    }
    return
  }

  await withNodeLoading(key, async () => {
    if (n._type === 'resource') {
      connMetadataCache.invalidate(cacheKey(n._conn, n._path))
    } else if (n._type === 'conn') {
      connMetadataCache.invalidate(cacheKey(n._conn))
    }

    await loadChildrenForKey(key, node)

    // 分类夹右键刷新只重拉 children，不会重拉 categoryCounts；用子节点数同步「字典 (n)」徽章
    if (n._type === 'resource') {
      const last = n._path.segments.at(-1)
      if (last?.kind === 'category') {
        patchCategoryObjectCount(n._conn, n._path)
      }
    }
  })
}

/**
 * 懒加载连接树资源子节点，并把结果合并进展示树。
 * 多次调用共享同一 `childCache` 单例（见上方性能注释）。
 */
export function useConnTreeChildren() {
  return {
    displayNodes,
    loadData,
    isLoaded,
    invalidate: invalidateConnTreeChildren,
    refreshNode,
  }
}

function deleteCacheKeys(
  cache: Map<string, ConnResourceNode[]>,
  key: string,
  deep: boolean,
): void {
  cache.delete(key)
  if (!deep) return
  const prefix = `${key}:`
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(prefix)) cache.delete(k)
  }
}

/**
 * DDL / 建库等变更后刷新连接根下的库列表。
 * 默认只重拉连接根一层，保留其它库下已展开缓存；可用 prunePaths 清掉被删/改名对象子树。
 */
export async function refreshConnTreeRoot(
  conn: ConnItem,
  options?: { prunePaths?: ConnResourcePath[] },
): Promise<void> {
  const key = connTreeKey(conn.profileId)
  const wasLoaded = childCache.value.has(key)
  const next = new Map(childCache.value)
  next.delete(key)
  for (const path of options?.prunePaths ?? []) {
    deleteCacheKeys(next, resourceTreeKey(conn.profileId, path), true)
    connMetadataCache.invalidate(cacheKey(conn, path))
  }
  childCache.value = next
  connMetadataCache.invalidate(cacheKey(conn))
  if (!wasLoaded) {
    return
  }
  await withNodeLoading(key, async () => {
    await ensureConnKind(conn.kind)
    const provider = getConnTreeProvider(conn.kind)
    if (!provider?.canExpand(conn)) {
      return
    }
    const descriptors = await connMetadataCache.fetch(cacheKey(conn), () => provider.loadChildren(conn))
    childCache.value = new Map(childCache.value).set(
      key,
      descriptors.map((d) => descriptorToNode(conn, d)),
    )
  })
}

/** DDL 后刷新指定资源节点（若已展开加载过），否则仅失效该子树缓存。 */
export async function refreshResourceIfLoaded(
  conn: ConnItem,
  path: ConnResourcePath,
  options?: { deep?: boolean; prunePaths?: ConnResourcePath[] },
): Promise<void> {
  const key = resourceTreeKey(conn.profileId, path)
  const deep = options?.deep !== false
  const wasLoaded = childCache.value.has(key)
  const next = new Map(childCache.value)
  deleteCacheKeys(next, key, deep)
  for (const prune of options?.prunePaths ?? []) {
    deleteCacheKeys(next, resourceTreeKey(conn.profileId, prune), true)
    connMetadataCache.invalidate(cacheKey(conn, prune))
  }
  childCache.value = next
  connMetadataCache.invalidate(cacheKey(conn, path))
  if (!wasLoaded) {
    return
  }
  await withNodeLoading(key, async () => {
    await ensureConnKind(conn.kind)
    const provider = getConnTreeProvider(conn.kind)
    if (!provider) {
      return
    }
    const descriptors = await connMetadataCache.fetch(cacheKey(conn, path), () =>
      provider.loadChildren(conn, path),
    )
    childCache.value = new Map(childCache.value).set(
      key,
      descriptors.map((d) => descriptorToNode(conn, d)),
    )
    // 与 refreshNode 一致：分类列表刷新后同步父级徽章
    const last = path.segments.at(-1)
    if (last?.kind === 'category') {
      patchCategoryObjectCount(conn, path)
    }
  })
}

function parseCategoryCount(node: ConnResourceNode): number | undefined {
  if (node._badge && /^\d+$/.test(node._badge)) {
    return Number(node._badge)
  }
  const matched = /\((\d+)\)$/.exec((node.label ?? '').trimEnd())
  return matched ? Number(matched[1]) : undefined
}

/** 去掉 label 末尾的「 (n)」计数后缀；用可选单空格，避免 `\s*` 双侧量词回溯。 */
function stripCategoryCountSuffix(label: string): string {
  return label.replace(/ ?\(\d+\)$/, '').trimEnd()
}

function isHintResourceNode(node: ConnResourceNode): boolean {
  const last = node._path.segments.at(-1)
  return last?.kind === 'hint'
}

/** 未截断时返回子节点数；含 hint 截断则返回 undefined。 */
function countCategoryChildren(children: ConnResourceNode[]): number | undefined {
  let count = 0
  for (const child of children) {
    if (isHintResourceNode(child)) return undefined
    count += 1
  }
  return count
}

function resolveCategoryCount(
  node: ConnResourceNode,
  children: ConnResourceNode[] | undefined,
  delta?: number,
): number | undefined {
  if (children) {
    const fromList = countCategoryChildren(children)
    if (fromList !== undefined) return fromList
  }
  if (delta === undefined || delta === 0) return undefined
  const current = parseCategoryCount(node)
  if (current === undefined) return undefined
  return Math.max(0, current + delta)
}

/**
 * 就地更新分类夹「表 (n)」计数徽章，不重拉 schema/database（避免 categoryCounts 全量查询）。
 * - 分类列表已加载且未截断：用子节点数同步
 * - 否则：用 delta 调整现有数字（新建 +1 / 删除 -1）
 */
export function patchCategoryObjectCount(
  conn: ConnItem,
  categoryPath: ConnResourcePath,
  options?: { delta?: number },
): void {
  const segments = categoryPath.segments
  if (segments.length < 2) return
  const last = segments.at(-1)
  if (last?.kind !== 'category') return

  const parentPath: ConnResourcePath = { segments: segments.slice(0, -1) }
  const parentKey = resourceTreeKey(conn.profileId, parentPath)
  const categoryKey = resourceTreeKey(conn.profileId, categoryPath)
  const siblings = childCache.value.get(parentKey)
  if (!siblings?.length) return

  const index = siblings.findIndex((node) => node.key === categoryKey)
  if (index < 0) return
  const node = siblings[index]
  if (!node) return

  const nextCount = resolveCategoryCount(
    node,
    childCache.value.get(categoryKey),
    options?.delta,
  )
  if (nextCount === undefined) return
  // 已是目标值则跳过，避免无意义触发树重渲染
  if (parseCategoryCount(node) === nextCount) return

  const baseLabel = stripCategoryCountSuffix(node.label ?? '') || node.label || ''
  const label = `${baseLabel} (${nextCount})`
  const patched: ConnResourceNode = {
    ...node,
    label,
    _badge: String(nextCount),
    _searchText: `${label} ${nextCount}`.trim().toLowerCase(),
  }
  const nextSiblings = siblings.slice()
  nextSiblings[index] = patched
  childCache.value = new Map(childCache.value).set(parentKey, nextSiblings)
}
