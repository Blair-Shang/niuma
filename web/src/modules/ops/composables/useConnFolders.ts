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

function saveFolders(folders: ConnFolder[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(folders))
  } catch {
    // storage not available
  }
}

function saveRootOrder(order: string[]): void {
  try {
    localStorage.setItem(ROOT_ORDER_KEY, JSON.stringify(order))
  } catch {
    // storage not available
  }
}

function cloneFolder(f: ConnFolder): ConnFolder {
  return { ...f, profileIds: [...f.profileIds] }
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
    saveFolders(folders.value)
    saveRootOrder(rootOrder.value)
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
      saveRootOrder(next)
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

  function createFolder(
    name: string,
    parentId: string | null = null,
    accentColor: ConnAccentColor = DEFAULT_FOLDER_ACCENT,
  ): ConnFolder {
    const folder: ConnFolder = {
      id: crypto.randomUUID(),
      name,
      expanded: true,
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

  function toggleFolder(id: string): void {
    folders.value = folders.value.map((f) =>
      f.id === id ? { ...f, expanded: !f.expanded } : f,
    )
    persist()
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
    syncRootOrder,
    createFolder,
    renameFolder,
    updateFolder,
    deleteFolder,
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
