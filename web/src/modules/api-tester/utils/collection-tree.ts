/**
 * 集合树：节点、搜索、拖放。对齐运维 useConnTree。
 * 数据已在 store，这里只组节点；不 default-expand-all，展开由面板受控。
 */
import type { RsTreeDropPosition, RsTreeNode } from '@niuma/ui'
import type { ApiFolder, ApiMethod } from '../types'
import {
  buildFolderChildrenIndex,
  canNestFolder,
  childFolders,
  collectDescendantFolderIds,
} from './folder-tree'

export const FOLDER_TREE_PREFIX = 'folder:'
export const REQUEST_TREE_PREFIX = 'req:'

export type ApiTreeCtx =
  | { kind: 'folder'; folderId: string }
  | { kind: 'request'; folderId: string; requestId: string }

export interface ApiFolderNode extends RsTreeNode {
  _type: 'folder'
  _folderId: string
  _count: number
}

export interface ApiRequestNode extends RsTreeNode {
  _type: 'request'
  _folderId: string
  _requestId: string
  _method: ApiMethod
  _url: string
  _searchText: string
}

export type ApiTreeNode = ApiFolderNode | ApiRequestNode

export interface ApiTreeDropMutations {
  moveRequest(requestId: string, folderId: string): boolean
  reorderRequest(dragId: string, dropId: string, position: 'before' | 'after'): boolean
  moveFolder(folderId: string, parentId: string | null): boolean
  reorderFolder(dragId: string, dropId: string, position: 'before' | 'after'): boolean
}

export function folderTreeKey(folderId: string): string {
  return `${FOLDER_TREE_PREFIX}${folderId}`
}

export function requestTreeKey(requestId: string): string {
  return `${REQUEST_TREE_PREFIX}${requestId}`
}

export function parseApiTreeKey(key: string): { type: 'folder' | 'request'; id: string } | null {
  if (key.startsWith(FOLDER_TREE_PREFIX)) {
    return { type: 'folder', id: key.slice(FOLDER_TREE_PREFIX.length) }
  }
  if (key.startsWith(REQUEST_TREE_PREFIX)) {
    return { type: 'request', id: key.slice(REQUEST_TREE_PREFIX.length) }
  }
  return null
}

export function isApiFolderNode(node: RsTreeNode): node is ApiFolderNode {
  return (node as ApiFolderNode)._type === 'folder'
}

export function isApiRequestNode(node: RsTreeNode): node is ApiRequestNode {
  return (node as ApiRequestNode)._type === 'request'
}

export function apiTreeCtxOf(node: RsTreeNode): ApiTreeCtx | null {
  if (isApiRequestNode(node)) {
    return { kind: 'request', folderId: node._folderId, requestId: node._requestId }
  }
  if (isApiFolderNode(node)) {
    return { kind: 'folder', folderId: node._folderId }
  }
  return null
}

/** 只组根以下节点。walking 挡住 parentId 环，但当前节点本身必须还能往下走。 */
export function buildCollectionTreeNodes(folders: readonly ApiFolder[]): ApiTreeNode[] {
  const index = buildFolderChildrenIndex(folders)
  const walk = (parentId: string | null, walking: Set<string>): ApiTreeNode[] => {
    const nodes: ApiTreeNode[] = []
    for (const folder of childFolders(folders, parentId, index)) {
      if (walking.has(folder.id)) continue
      const next = new Set(walking)
      next.add(folder.id)
      const childFolderNodes = walk(folder.id, next)
      const requestNodes: ApiRequestNode[] = folder.requests.map((req) => ({
        key: requestTreeKey(req.id),
        label: req.name,
        isLeaf: true,
        _type: 'request',
        _folderId: folder.id,
        _requestId: req.id,
        _method: req.method,
        _url: req.url,
        _searchText: `${req.name} ${req.method} ${req.url}`.toLowerCase(),
      }))
      const children = [...childFolderNodes, ...requestNodes]
      nodes.push({
        key: folderTreeKey(folder.id),
        label: folder.name,
        isLeaf: children.length === 0,
        children: children.length > 0 ? children : undefined,
        _type: 'folder',
        _folderId: folder.id,
        _count: folder.requests.length,
      })
    }
    return nodes
  }
  return walk(null, new Set())
}

/** RsTree filter-node：keyword 已被 trim；字段小写预计算。 */
export function apiCollectionSearchMatch(node: ApiTreeNode, keyword: string): boolean {
  const q = keyword.toLowerCase()
  if (!q) return true
  if (node._type === 'request') return node._searchText.includes(q)
  return (node.label ?? '').toLowerCase().includes(q)
}

/**
 * 拖放：
 * - 请求 → 文件夹任意位置：归入该文件夹
 * - 请求 → 请求前/后：同夹排序或先搬再排
 * - 文件夹 → 文件夹内：嵌套（深度 / 环拦截）
 * - 文件夹 → 文件夹前/后：改父级并同级排序
 */
export function allowApiTreeDrop(
  folders: readonly ApiFolder[],
  dragKey: string,
  dropKey: string,
  position: RsTreeDropPosition,
): boolean {
  const drag = parseApiTreeKey(dragKey)
  const drop = parseApiTreeKey(dropKey)
  if (!drag || !drop || dragKey === dropKey) return false

  if (drag.type === 'folder') {
    if (drop.type !== 'folder') return false
    if (position === 'inside') return canNestFolder(folders, drag.id, drop.id)
    const dropFolder = folders.find((folder) => folder.id === drop.id)
    const dragFolder = folders.find((folder) => folder.id === drag.id)
    if (!dropFolder || !dragFolder) return false
    if (collectDescendantFolderIds(folders, drag.id).includes(drop.id)) return false
    if (dropFolder.parentId === null || dropFolder.parentId === dragFolder.parentId) return true
    return canNestFolder(folders, drag.id, dropFolder.parentId)
  }

  if (drop.type === 'folder') return true
  return position === 'before' || position === 'after' || position === 'inside'
}

export function handleApiTreeDrop(
  mutations: ApiTreeDropMutations,
  dragKey: string,
  dropKey: string,
  position: RsTreeDropPosition,
): boolean {
  const drag = parseApiTreeKey(dragKey)
  const drop = parseApiTreeKey(dropKey)
  if (!drag || !drop) return false

  if (drag.type === 'folder') {
    if (drop.type !== 'folder') return false
    if (position === 'inside') return mutations.moveFolder(drag.id, drop.id)
    return mutations.reorderFolder(drag.id, drop.id, position)
  }

  if (drop.type === 'folder') return mutations.moveRequest(drag.id, drop.id)
  if (position === 'inside') return mutations.reorderRequest(drag.id, drop.id, 'after')
  return mutations.reorderRequest(drag.id, drop.id, position)
}
