import { connectionApi } from '@/api'
import { isBridgeAvailable } from '@/api/client'
import { isPlatformUnavailable, withPlatformRetry } from '@/api/platform'
import type { ConnectionExportOrganization } from '@/api/types/connection'
import {
  connTreeKey,
  folderTreeKey,
  parseTreeKey,
} from '@/modules/ops/conn-tree/keys'
import { DEFAULT_FOLDER_ACCENT, folderAccentColor, type ConnAccentColor, type ConnItem } from '../types'

export interface ConnFolder {
  id: string
  name: string
  expanded: boolean
  profileIds: string[]
  /** null = 根层级 */
  parentId: string | null
  /** 侧栏文件夹标签色 */
  accentColor?: ConnAccentColor
}

export type OrgEntry =
  | { type: 'folder'; folder: ConnFolder; items: ConnItem[] }
  | { type: 'item'; item: ConnItem }

const STORAGE_KEY = 'nm-conn-folders-v1'
const ROOT_ORDER_KEY = 'nm-conn-root-order-v1'

import { ref } from 'vue'

export { connTreeKey, folderTreeKey, parseTreeKey } from '@/modules/ops/conn-tree/keys'

function loadFolders(): ConnFolder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return (JSON.parse(raw) as ConnFolder[]).map((f) => ({
      ...f,
      parentId: f.parentId ?? null,
      profileIds: [...f.profileIds],
      accentColor: folderAccentColor(f),
    }))
  } catch {
    return []
  }
}

function loadRootOrder(folders: ConnFolder[]): string[] {
  try {
    const raw = localStorage.getItem(ROOT_ORDER_KEY)
    if (raw) return JSON.parse(raw) as string[]
  } catch {
    // ignore
  }
  return folders.filter((f) => !f.parentId).map((f) => folderTreeKey(f.id))
}

function saveFoldersLocal(folders: ConnFolder[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(folders))
  } catch {
    // storage not available
  }
}

function saveRootOrderLocal(order: string[]): void {
  try {
    localStorage.setItem(ROOT_ORDER_KEY, JSON.stringify(order))
  } catch {
    // storage not available
  }
}

function clearLocalOrganization(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(ROOT_ORDER_KEY)
  } catch {
    // storage not available
  }
}

function toOrganization(folders: ConnFolder[], rootOrder: string[]): ConnectionExportOrganization {
  return {
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      profileIds: [...f.profileIds],
      accentColor: f.accentColor,
      expanded: f.expanded,
    })),
    rootOrder: [...rootOrder],
  }
}

function fromOrganization(org: ConnectionExportOrganization | null | undefined): {
  folders: ConnFolder[]
  rootOrder: string[]
} {
  const folders = (org?.folders ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    expanded: f.expanded ?? true,
    profileIds: [...(f.profileIds ?? [])],
    parentId: f.parentId ?? null,
    accentColor: folderAccentColor({ accentColor: f.accentColor }),
  }))
  return { folders, rootOrder: [...(org?.rootOrder ?? [])] }
}

function flushOrganizationToPlatform(folders: ConnFolder[], rootOrder: string[]): Promise<void> {
  if (!isBridgeAvailable()) {
    saveFoldersLocal(folders)
    saveRootOrderLocal(rootOrder)
    return Promise.resolve()
  }
  const payload = toOrganization(folders, rootOrder)
  const run = connectionApi
    .setOrganization({ organization: payload })
    .then(() => undefined)
    .catch((error: unknown) => {
      if (isPlatformUnavailable(error)) {
        saveFoldersLocal(folders)
        saveRootOrderLocal(rootOrder)
        return
      }
      console.warn('[conn-folders] platform save failed', error)
    })
  return run
}

function cloneFolder(f: ConnFolder): ConnFolder {
  return { ...f, profileIds: [...f.profileIds] }
}

/**
 * 同级文件夹重名时在名称后追加递增数字：新建文件夹 → 新建文件夹1 → 新建文件夹2。
 * 仅与传入的已占用名称比较，跨层级允许同名。
 */
export function uniqueSiblingFolderName(name: string, takenNames: Iterable<string>): string {
  const taken = new Set(takenNames)
  if (!taken.has(name)) return name
  let n = 1
  while (taken.has(`${name}${n}`)) n += 1
  return `${name}${n}`
}

/** createFolder 用 [...prev, created] 追加，引用前缀不变时可走增量插树。 */
export function isFolderListAppend(
  prev: readonly ConnFolder[] | undefined,
  next: readonly ConnFolder[],
): boolean {
  if (!prev) return false
  if (next.length !== prev.length + 1) return false
  return prev.every((folder, index) => next[index] === folder)
}

const foldersRef = ref<ConnFolder[]>(loadFolders())
const rootOrderRef = ref<string[]>(loadRootOrder(foldersRef.value))

export function isFolderUnder(
  folders: readonly ConnFolder[],
  folderId: string,
  ancestorId: string,
): boolean {
  let current: ConnFolder | undefined = folders.find((f) => f.id === folderId)
  while (current) {
    if (current.id === ancestorId) return true
    const parentId = current.parentId
    if (!parentId) return false
    current = folders.find((f) => f.id === parentId)
  }
  return false
}

export function wouldCreateFolderCycle(
  folders: readonly ConnFolder[],
  dragId: string,
  newParentId: string,
): boolean {
  return dragId === newParentId || isFolderUnder(folders, newParentId, dragId)
}

export function useConnFolders() {
  const folders = foldersRef
  const rootOrder = rootOrderRef

  function persist(): void {
    if (!isBridgeAvailable()) {
      saveFoldersLocal(folders.value)
      saveRootOrderLocal(rootOrder.value)
      return
    }
    void flushOrganizationToPlatform(folders.value, rootOrder.value)
  }

  /** 从 SQLite 拉取组织层；库空时把旧 localStorage 迁进去。 */
  async function hydrate(): Promise<void> {
    if (!isBridgeAvailable()) {
      return
    }
    try {
      const res = await withPlatformRetry(() => connectionApi.getOrganization({}))
      const remote = fromOrganization(res.organization)
      const remoteEmpty = remote.folders.length === 0 && remote.rootOrder.length === 0
      if (remoteEmpty && (folders.value.length > 0 || rootOrder.value.length > 0)) {
        await flushOrganizationToPlatform(folders.value, rootOrder.value)
        clearLocalOrganization()
        return
      }
      folders.value = remote.folders
      rootOrder.value = remote.rootOrder
      clearLocalOrganization()
    } catch (error) {
      if (!isPlatformUnavailable(error)) {
        console.warn('[conn-folders] platform load failed', error)
      }
    }
  }

  /** 补齐 rootOrder：根文件夹 + 未分组连接 */
  function syncRootOrder(allConns: ConnItem[]): void {
    const assigned = new Set(folders.value.flatMap((f) => f.profileIds))
    const valid = new Set<string>()
    for (const f of folders.value) {
      if (!f.parentId) valid.add(folderTreeKey(f.id))
    }
    for (const c of allConns) {
      if (!assigned.has(c.profileId)) valid.add(connTreeKey(c.profileId))
    }
    const next = rootOrder.value.filter((k) => valid.has(k))
    const nextSet = new Set(next)
    for (const k of valid) {
      if (!nextSet.has(k)) next.push(k)
    }
    if (next.join('\0') !== rootOrder.value.join('\0')) {
      rootOrder.value = next
      persist()
    }
  }

  function insertRootOrder(key: string, targetKey: string, position: 'before' | 'after'): void {
    const order = rootOrder.value.filter((k) => k !== key)
    const idx = order.indexOf(targetKey)
    if (idx < 0) {
      order.push(key)
    } else {
      order.splice(position === 'before' ? idx : idx + 1, 0, key)
    }
    rootOrder.value = order
    persist()
  }

  function siblingFolderNames(parentId: string | null, excludeId?: string): string[] {
    return folders.value
      .filter((f) => (f.parentId ?? null) === parentId && f.id !== excludeId)
      .map((f) => f.name)
  }

  /** 按同级已有名称生成不重复的文件夹名。 */
  function nextFolderName(name: string, parentId: string | null = null, excludeId?: string): string {
    return uniqueSiblingFolderName(name, siblingFolderNames(parentId, excludeId))
  }

  function createFolder(
    name: string,
    parentId: string | null = null,
    accentColor: ConnAccentColor = DEFAULT_FOLDER_ACCENT,
    expanded = true,
  ): ConnFolder {
    const folder: ConnFolder = {
      id: crypto.randomUUID(),
      name: nextFolderName(name, parentId),
      expanded,
      profileIds: [],
      parentId,
      accentColor,
    }
    folders.value = [...folders.value, folder]
    if (!parentId) {
      rootOrder.value = [...rootOrder.value, folderTreeKey(folder.id)]
    }
    persist()
    return folder
  }

  function renameFolder(id: string, name: string): void {
    updateFolder(id, { name })
  }

  function updateFolder(
    id: string,
    patch: { name?: string; accentColor?: ConnAccentColor },
  ): void {
    folders.value = folders.value.map((f) => (f.id === id ? { ...f, ...patch } : f))
    persist()
  }

  function deleteFolder(id: string): void {
    const toRemove = new Set<string>([id])
    let changed = true
    while (changed) {
      changed = false
      for (const f of folders.value) {
        if (f.parentId && toRemove.has(f.parentId) && !toRemove.has(f.id)) {
          toRemove.add(f.id)
          changed = true
        }
      }
    }
    folders.value = folders.value.filter((f) => !toRemove.has(f.id))
    rootOrder.value = rootOrder.value.filter((k) => {
      const parsed = parseTreeKey(k)
      return parsed.type !== 'folder' || !toRemove.has(parsed.id)
    })
    persist()
  }

  /**
   * 就地更新展开态并落盘，不替换 folders 数组，避免连接树整树重建。
   */
  function setFolderExpanded(id: string, expanded: boolean): void {
    const folder = folders.value.find((f) => f.id === id)
    if (!folder || folder.expanded === expanded) return
    folder.expanded = expanded
    persist()
  }

  /** 按当前树展开键回写文件夹 expanded；未出现在 keys 里的文件夹视为折叠。 */
  function syncFolderExpandedFromKeys(keys: readonly string[]): void {
    const expanded = new Set(keys)
    let changed = false
    for (const folder of folders.value) {
      const next = expanded.has(folderTreeKey(folder.id))
      if (folder.expanded === next) continue
      folder.expanded = next
      changed = true
    }
    if (changed) persist()
  }

  function toggleFolder(id: string): void {
    const folder = folders.value.find((f) => f.id === id)
    if (!folder) return
    setFolderExpanded(id, !folder.expanded)
  }

  function moveToFolder(profileId: string, folderId: string | null): void {
    folders.value = folders.value.map((f) => {
      const profileIds = f.profileIds.filter((id) => id !== profileId)
      if (folderId && f.id === folderId) {
        return { ...f, profileIds: [...profileIds, profileId] }
      }
      if (profileIds.length !== f.profileIds.length) {
        return { ...f, profileIds }
      }
      return cloneFolder(f)
    })
    rootOrder.value = rootOrder.value.filter((k) => k !== connTreeKey(profileId))
    persist()
  }

  function nestFolder(dragFolderId: string, parentFolderId: string): void {
    if (wouldCreateFolderCycle(folders.value, dragFolderId, parentFolderId)) return

    const list = folders.value.map(cloneFolder)
    const fromIdx = list.findIndex((f) => f.id === dragFolderId)
    if (fromIdx < 0) return

    const [item] = list.splice(fromIdx, 1)
    item.parentId = parentFolderId

    const parentIdx = list.findIndex((f) => f.id === parentFolderId)
    list.splice(parentIdx + 1, 0, item)

    folders.value = list
    rootOrder.value = rootOrder.value.filter((k) => k !== folderTreeKey(dragFolderId))
    persist()
  }

  function reorderFolderSiblings(
    dragFolderId: string,
    dropFolderId: string,
    position: 'before' | 'after',
  ): void {
    if (dragFolderId === dropFolderId) return
    const drop = folders.value.find((f) => f.id === dropFolderId)
    if (!drop) return
    const parentId = drop.parentId ?? null

    const list = folders.value.map(cloneFolder)
    const fromIdx = list.findIndex((f) => f.id === dragFolderId)
    if (fromIdx < 0) return

    const [item] = list.splice(fromIdx, 1)
    item.parentId = parentId

    let toIdx = list.findIndex((f) => f.id === dropFolderId)
    if (toIdx < 0) return
    if (position === 'after') toIdx += 1
    list.splice(toIdx, 0, item)

    folders.value = list

    if (parentId === null) {
      insertRootOrder(folderTreeKey(dragFolderId), folderTreeKey(dropFolderId), position)
    } else {
      persist()
    }
  }

  function reorderConnInFolder(
    profileId: string,
    targetProfileId: string,
    position: 'before' | 'after',
    folderId: string,
  ): void {
    folders.value = folders.value.map((f) => {
      if (f.id !== folderId) return cloneFolder(f)
      const ids = f.profileIds.filter((id) => id !== profileId)
      const targetIdx = ids.indexOf(targetProfileId)
      let insertAt = ids.length
      if (targetIdx >= 0) {
        insertAt = position === 'before' ? targetIdx : targetIdx + 1
      }
      ids.splice(insertAt, 0, profileId)
      return { ...f, profileIds: ids }
    })
    persist()
  }

  function organizeConns(conns: ConnItem[]): OrgEntry[] {
    const assignedIds = new Set(folders.value.flatMap((f) => f.profileIds))
    const result: OrgEntry[] = []
    for (const key of rootOrder.value) {
      const parsed = parseTreeKey(key)
      if (parsed.type === 'folder') {
        const folder = folders.value.find((f) => f.id === parsed.id && !f.parentId)
        if (!folder) continue
        const items = folder.profileIds
          .map((id) => conns.find((c) => c.profileId === id))
          .filter((c): c is ConnItem => c !== undefined)
        result.push({ type: 'folder', folder, items })
      } else if (!assignedIds.has(parsed.id)) {
        const item = conns.find((c) => c.profileId === parsed.id)
        if (item) result.push({ type: 'item', item })
      }
    }
    return result
  }

  return {
    folders,
    rootOrder,
    hydrate,
    syncRootOrder,
    createFolder,
    nextFolderName,
    renameFolder,
    updateFolder,
    deleteFolder,
    setFolderExpanded,
    syncFolderExpandedFromKeys,
    toggleFolder,
    moveToFolder,
    insertRootOrder,
    nestFolder,
    reorderFolderSiblings,
    reorderConnInFolder,
    organizeConns,
  }
}

export type ConnFolderMutations = ReturnType<typeof useConnFolders>
