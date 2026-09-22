/**
 * 集合树纯函数：深度、子节点索引、变量作用域、parentId 环检测。
 * 组件只消费这里的结果；导入解析必须先 normalizeFolderGraph，再交给树渲染。
 */
import type { ApiFolder, ApiRequest, ApiVariableBag } from '../types'

/** 嵌套文件夹最大深度（含根）。 */
export const MAX_FOLDER_DEPTH = 3

/** 变量插值时传给 interpolate / http-wire 的作用域。 */
export interface ApiVariableScope {
  folders?: readonly ApiFolder[]
  folderId?: string | null
  globals?: ApiVariableBag
}

/** 按 parentId 索引子文件夹，避免树/filter 反复 O(n) 扫描。 */
export function buildFolderChildrenIndex(folders: readonly ApiFolder[]): Map<string | null, ApiFolder[]> {
  const index = new Map<string | null, ApiFolder[]>()
  for (const folder of folders) {
    const parentId = folder.parentId
    const bucket = index.get(parentId) ?? []
    bucket.push(folder)
    index.set(parentId, bucket)
  }
  return index
}

/** 按 requestId 定位所在文件夹并组装变量作用域。 */
export function scopeForRequest(
  folders: readonly ApiFolder[],
  globals: ApiVariableBag,
  requestId?: string | null,
  folderIdByRequest?: ReadonlyMap<string, string>,
): ApiVariableScope {
  const folderId = requestId
    ? (folderIdByRequest?.get(requestId) ?? locateRequestFolder(folders, requestId)?.id ?? null)
    : null
  return {
    folders,
    folderId,
    globals,
  }
}

/** 返回 requestId 所在文件夹；未找到则 undefined。 */
export function locateRequestFolder(folders: readonly ApiFolder[], requestId: string): ApiFolder | undefined {
  for (const folder of folders) {
    if (folder.requests.some((req) => req.id === requestId)) return folder
  }
  return undefined
}

/** 1 为根文件夹，子级递增。遇到 parentId 环则视为超过上限，避免 while 挂死。 */
export function folderDepth(folders: readonly ApiFolder[], folderId: string): number {
  const seen = new Set<string>()
  let depth = 1
  let current = folders.find((item) => item.id === folderId)
  while (current?.parentId) {
    if (seen.has(current.id)) return MAX_FOLDER_DEPTH + 1
    seen.add(current.id)
    depth += 1
    current = folders.find((item) => item.id === current!.parentId)
  }
  return depth
}

/** 是否还能在该文件夹下新建子文件夹。 */
export function canAddChildFolder(folders: readonly ApiFolder[], parentId: string): boolean {
  return folderDepth(folders, parentId) < MAX_FOLDER_DEPTH
}

/** 文件夹子树高度（含自身）。环视为 1，避免递归挂死。 */
export function folderSubtreeHeight(folders: readonly ApiFolder[], folderId: string): number {
  const index = buildFolderChildrenIndex(folders)
  const walk = (id: string, walking: Set<string>): number => {
    if (walking.has(id)) return 1
    walking.add(id)
    const kids = index.get(id) ?? []
    if (kids.length === 0) return 1
    return 1 + Math.max(...kids.map((child) => walk(child.id, walking)))
  }
  return walk(folderId, new Set())
}

/**
 * 能否把 drag 挂到 drop 下面。
 * 禁止挂到自己或后代；挂完后最深节点不得超过 MAX_FOLDER_DEPTH。
 */
export function canNestFolder(folders: readonly ApiFolder[], dragId: string, dropId: string): boolean {
  if (dragId === dropId) return false
  if (!folders.some((folder) => folder.id === dropId)) return false
  if (collectDescendantFolderIds(folders, dragId).includes(dropId)) return false
  return folderDepth(folders, dropId) + folderSubtreeHeight(folders, dragId) <= MAX_FOLDER_DEPTH
}

/** 含自身在内的所有后代文件夹 id（深度优先）。visited 挡住 parentId 环。 */
export function collectDescendantFolderIds(folders: readonly ApiFolder[], rootId: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
    for (const folder of folders) {
      if (folder.parentId !== id) continue
      walk(folder.id)
    }
  }
  walk(rootId)
  return out
}

/**
 * 导入 / hydrate 后把坏 parentId 掰回根：指向不存在的父节点，或走回自身的环。
 * 就地修改并返回同一数组，调用方不必再拷一份。
 */
export function normalizeFolderGraph(folders: ApiFolder[]): ApiFolder[] {
  const ids = new Set(folders.map((folder) => folder.id))
  for (const folder of folders) {
    if (folder.parentId && !ids.has(folder.parentId)) {
      folder.parentId = null
    }
  }
  for (const folder of folders) {
    if (folder.parentId && parentChainCycles(folders, folder.id)) {
      folder.parentId = null
    }
  }
  return folders
}

/** 从该节点沿 parentId 上行是否撞见已访问 id。 */
export function parentChainCycles(folders: readonly ApiFolder[], folderId: string): boolean {
  const seen = new Set<string>()
  let current = folders.find((item) => item.id === folderId)
  while (current) {
    if (seen.has(current.id)) return true
    seen.add(current.id)
    current = current.parentId ? folders.find((item) => item.id === current!.parentId) : undefined
  }
  return false
}

/** 某文件夹（含子文件夹）下的全部请求，深度优先。 */
export function materializeFolderRequests(folders: readonly ApiFolder[], folderId: string): ApiRequest[] {
  const out: ApiRequest[] = []
  for (const id of collectDescendantFolderIds(folders, folderId)) {
    const folder = folders.find((item) => item.id === id)
    if (folder) out.push(...folder.requests)
  }
  return out
}

/** 所有根文件夹下的全部请求。 */
export function materializeCollectionRequests(folders: readonly ApiFolder[]): ApiRequest[] {
  const out: ApiRequest[] = []
  for (const folder of folders.filter((item) => item.parentId === null)) {
    out.push(...materializeFolderRequests(folders, folder.id))
  }
  return out
}

/** 按 parentId 取直接子文件夹。 */
export function childFolders(
  folders: readonly ApiFolder[],
  parentId: string | null,
  index?: ReadonlyMap<string | null, ApiFolder[]>,
): ApiFolder[] {
  return index?.get(parentId) ?? folders.filter((item) => item.parentId === parentId)
}

/** 按 id 查请求。 */
export function requestByIdInFolders(folders: readonly ApiFolder[], requestId: string): ApiRequest | undefined {
  for (const folder of folders) {
    const hit = folder.requests.find((req) => req.id === requestId)
    if (hit) return hit
  }
  return undefined
}
