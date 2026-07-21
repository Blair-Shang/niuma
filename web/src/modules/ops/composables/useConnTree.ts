import { computed, watchEffect } from 'vue'
import type { Ref } from 'vue'
import type { RsTreeDropPosition, RsTreeNode } from '@niuma/ui'
import { connectionKindsForCategory } from '@/extensions/shell/activity-bar-config'
import type { ModuleCategory } from '@/extensions/types/module'
import {
  connTreeKey,
  folderTreeKey,
  parseTreeKey,
} from '@/modules/ops/conn-tree/keys'
import { connKindHasTree } from '@/modules/ops/conn-kind-loaders'
import { getConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import {
  wouldCreateFolderCycle,
  type ConnFolder,
} from './useConnFolders'
import type { ConnItem } from '../types'

/* ── 扩展节点类型，携带业务数据 ── */

export interface ConnFolderNode extends RsTreeNode {
  _type: 'folder'
  _folder: ConnFolder
}

export interface ConnLeafNode extends RsTreeNode {
  _type: 'conn'
  _conn: ConnItem
  /** 预计算的搜索文本（小写），避免每次搜索重复调用 toLowerCase */
  _searchText: string
}

export interface ConnResourceNode extends RsTreeNode {
  _type: 'resource'
  _conn: ConnItem
  _path: ConnResourcePath
  _searchText: string
  _badge?: string
  _icon?: string
}

export type ConnTreeNode = ConnFolderNode | ConnLeafNode | ConnResourceNode

function makeLeaf(conn: ConnItem): ConnLeafNode {
  const provider = getConnTreeProvider(conn.kind)
  const expandable = provider?.canExpand(conn) ?? connKindHasTree(conn.kind)
  return {
    key: connTreeKey(conn.profileId),
    label: conn.profileName,
    isLeaf: !expandable,
    children: expandable ? [] : undefined,
    _type: 'conn',
    _conn: conn,
    _searchText: `${conn.profileName.toLowerCase()} ${conn.hostAddress.toLowerCase()}`,
  }
}

function buildFolderNode(
  folder: ConnFolder,
  folders: readonly ConnFolder[],
  connById: ReadonlyMap<string, ConnItem>,
  folderIndexMap: ReadonlyMap<string, number>,
): ConnFolderNode | null {
  const childFolders = folders
    .filter((f) => f.parentId === folder.id)
    .sort((a, b) => (folderIndexMap.get(a.id) ?? 0) - (folderIndexMap.get(b.id) ?? 0))
    .map((f) => buildFolderNode(f, folders, connById, folderIndexMap))
    .filter((node): node is ConnFolderNode => node !== null)

  const childConns = folder.profileIds
    .map((id) => connById.get(id))
    .filter((c): c is ConnItem => c !== undefined)
    .map(makeLeaf)

  const children = [...childFolders, ...childConns]

  return {
    key: folderTreeKey(folder.id),
    label: folder.name,
    _type: 'folder',
    _folder: { ...folder },
    children,
  }
}

function buildRootNodes(
  folders: readonly ConnFolder[],
  conns: readonly ConnItem[],
  rootOrder: readonly string[],
): ConnTreeNode[] {
  const connById = new Map(conns.map((c) => [c.profileId, c]))
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const folderIndexMap = new Map(folders.map((f, i) => [f.id, i]))
  const assigned = new Set(folders.flatMap((f) => f.profileIds))
  const result: ConnTreeNode[] = []

  for (const key of rootOrder) {
    const parsed = parseTreeKey(key)
    if (parsed.type === 'folder') {
      const folder = folderById.get(parsed.id)
      if (folder && !folder.parentId) {
        const node = buildFolderNode(folder, folders, connById, folderIndexMap)
        if (node) {
          result.push(node)
        }
      }
      continue
    }
    if (!assigned.has(parsed.id)) {
      const conn = connById.get(parsed.id)
      if (conn) result.push(makeLeaf(conn))
    }
  }
  return result
}

/**
 * 级联过滤连接树（与 RsTree `filterTreeNodes` 同算法：子节点匹配则保留父级）。
 */
export function cascadeFilterConnTree(
  nodes: readonly ConnTreeNode[],
  match: (node: ConnTreeNode) => boolean,
): ConnTreeNode[] {
  function filterNode(node: ConnTreeNode): ConnTreeNode | null {
    const children = (node.children ?? []) as ConnTreeNode[]
    const filteredChildren = children
      .map(filterNode)
      .filter((item): item is ConnTreeNode => item !== null)

    if (match(node)) {
      return { ...node, children }
    }
    if (filteredChildren.length > 0) {
      return { ...node, children: filteredChildren }
    }
    return null
  }

  return nodes
    .map(filterNode)
    .filter((item): item is ConnTreeNode => item !== null)
}

/** Activity 分类过滤：与搜索共用级联算法，仅匹配条件按连接 kind 区分。 */
export function filterConnTreeByCategory(
  nodes: readonly ConnTreeNode[],
  category: ModuleCategory,
): ConnTreeNode[] {
  const kinds = connectionKindsForCategory(category)
  if (!kinds) {
    return [...nodes]
  }
  const allowed = new Set(kinds)
  return cascadeFilterConnTree(
    nodes,
    (node) => node._type === 'conn' && allowed.has(node._conn.kind),
  )
}

/** 搜索匹配：连接名 / 主机名 / 文件夹名。
 *
 * keyword 由 RsTree 传入时已经 trim 过（filterTreeNodes 中的 query = keyword.trim()），
 * 此处只做一次 toLowerCase，不再对节点字段重复转换（_searchText 已预计算）。
 */
export function connTreeSearchMatch(node: ConnTreeNode, keyword: string): boolean {
  const q = keyword.toLowerCase()
  if (!q) return true
  if (node._type === 'conn') return node._searchText.includes(q)
  if (node._type === 'resource') return node._searchText.includes(q)
  if (node._type === 'folder') return (node.label ?? '').toLowerCase().includes(q)
  return false
}

/** 收集可展开节点 key（文件夹）。 */
export function collectExpandableConnKeys(nodes: readonly ConnTreeNode[]): string[] {
  const keys: string[] = []
  for (const node of nodes) {
    if (!node.key) {
      continue
    }
    if (node.children?.length) {
      keys.push(node.key, ...collectExpandableConnKeys(node.children as ConnTreeNode[]))
    }
  }
  return keys
}

/**
 * 拖放规则：
 * - folder → folder inside：嵌套；before/after：同级排序
 * - conn → folder inside：归入文件夹；before/after folder（根级）/根级 conn：移到根并按序插入
 */
export function allowDrop(
  dragKey: string,
  dropKey: string,
  position: RsTreeDropPosition,
  folders: readonly ConnFolder[] = [],
): boolean {
  if (dragKey.startsWith('res:') || dropKey.startsWith('res:')) {
    return false
  }
  const dragType = dragKey.split(':')[0]
  const dropType = dropKey.split(':')[0]
  if (dragKey === dropKey) return false

  if (dragType === 'folder') {
    if (dropType !== 'folder') return false
    if (position === 'inside') {
      const dragId = dragKey.slice('folder:'.length)
      const dropId = dropKey.slice('folder:'.length)
      return !wouldCreateFolderCycle(folders, dragId, dropId)
    }
    return position === 'before' || position === 'after'
  }

  if (dragType === 'conn') {
    if (position === 'inside') return dropType === 'folder'
    if (position === 'before' || position === 'after') {
      return dropType === 'conn' || dropType === 'folder'
    }
  }

  return false
}

export interface ConnTreeDropMutations {
  moveToFolder(profileId: string, folderId: string | null): void
  insertRootOrder(key: string, targetKey: string, position: 'before' | 'after'): void
  nestFolder(dragFolderId: string, parentFolderId: string): void
  reorderFolderSiblings(dragFolderId: string, dropFolderId: string, position: 'before' | 'after'): void
  reorderConnInFolder(
    profileId: string,
    targetProfileId: string,
    position: 'before' | 'after',
    folderId: string,
  ): void
}

function handleFolderDrop(
  mutations: ConnTreeDropMutations,
  dragKey: string,
  dropKey: string,
  position: RsTreeDropPosition,
): boolean {
  if (!dragKey.startsWith('folder:')) return false

  const dragFolderId = dragKey.slice('folder:'.length)
  if (!dropKey.startsWith('folder:')) return true

  const dropFolderId = dropKey.slice('folder:'.length)
  if (position === 'inside') {
    mutations.nestFolder(dragFolderId, dropFolderId)
    return true
  }
  if (position === 'before' || position === 'after') {
    mutations.reorderFolderSiblings(dragFolderId, dropFolderId, position)
  }
  return true
}

function moveConnAroundFolder(
  folders: Ref<ConnFolder[]>,
  mutations: ConnTreeDropMutations,
  profileId: string,
  connKey: string,
  dropKey: string,
  position: 'before' | 'after',
): void {
  const dropFolder = folders.value.find((f) => f.id === dropKey.slice('folder:'.length))
  if (dropFolder?.parentId) {
    mutations.moveToFolder(profileId, dropFolder.parentId)
    return
  }
  mutations.moveToFolder(profileId, null)
  mutations.insertRootOrder(connKey, dropKey, position)
}

function moveConnAroundConn(
  folders: Ref<ConnFolder[]>,
  mutations: ConnTreeDropMutations,
  profileId: string,
  connKey: string,
  dropKey: string,
  position: 'before' | 'after',
): void {
  const dropProfileId = dropKey.slice('conn:'.length)
  const folder = folders.value.find((f) => f.profileIds.includes(dropProfileId))
  if (folder) {
    mutations.moveToFolder(profileId, folder.id)
    mutations.reorderConnInFolder(profileId, dropProfileId, position, folder.id)
    return
  }
  mutations.moveToFolder(profileId, null)
  mutations.insertRootOrder(connKey, dropKey, position)
}

export function handleConnTreeDrop(
  folders: Ref<ConnFolder[]>,
  mutations: ConnTreeDropMutations,
  dragKey: string,
  dropKey: string,
  position: RsTreeDropPosition,
): void {
  if (handleFolderDrop(mutations, dragKey, dropKey, position)) {
    return
  }

  if (!dragKey.startsWith('conn:')) return
  const profileId = dragKey.slice('conn:'.length)
  const connKey = connTreeKey(profileId)

  if (position === 'inside' && dropKey.startsWith('folder:')) {
    mutations.moveToFolder(profileId, dropKey.slice('folder:'.length))
    return
  }

  if (position !== 'before' && position !== 'after') return

  if (dropKey.startsWith('folder:')) {
    moveConnAroundFolder(folders, mutations, profileId, connKey, dropKey, position)
    return
  }

  if (!dropKey.startsWith('conn:')) return
  moveConnAroundConn(folders, mutations, profileId, connKey, dropKey, position)
}

/**
 * 构建连接树：根层级顺序由 rootOrder 驱动，支持文件夹嵌套。
 *
 * syncRootOrder 有写 localStorage / 修改 rootOrder 的副作用，须放在 watchEffect 而非
 * computed getter 中，确保副作用与计算逻辑分离，避免 computed 追踪到不必要的依赖。
 */
export function useConnTree(
  conns: Ref<ConnItem[]>,
  folders: Ref<ConnFolder[]>,
  rootOrder: Ref<string[]>,
  syncRootOrder: (allConns: ConnItem[]) => void,
) {
  // flush:'pre' 保证在组件渲染读取 rootOrder 前先完成同步
  watchEffect(() => syncRootOrder(conns.value), { flush: 'pre' })

  const nodes = computed<ConnTreeNode[]>(() =>
    buildRootNodes(folders.value, conns.value, rootOrder.value),
  )

  return { nodes, allowDrop, handleConnTreeDrop }
}
