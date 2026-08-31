import { connectionApi } from '@/api'
import { isBridgeAvailable } from '@/api/client'
import { withPlatformRetry } from '@/api/platform'
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

import { ref } from 'vue'

export { connTreeKey, folderTreeKey, parseTreeKey } from '@/modules/ops/conn-tree/keys'

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

function cloneFolder(f: ConnFolder): ConnFolder {
  return { ...f, profileIds: [...f.profileIds] }
}

const EXPAND_PERSIST_MS = 300

function siblingFolderNamesOf(
  list: readonly ConnFolder[],
  parentId: string | null,
  excludeId?: string,
): string[] {
  return list
    .filter((f) => (f.parentId ?? null) === parentId && f.id !== excludeId)
    .map((f) => f.name)
}

function nextFolderNameIn(
  list: readonly ConnFolder[],
  name: string,
  parentId: string | null,
  excludeId?: string,
): string {
  return uniqueSiblingFolderName(name, siblingFolderNamesOf(list, parentId, excludeId))
}

/** 只改动涉及的文件夹对象，其余保持原引用。 */
function moveProfileOn(
  folders: ConnFolder[],
  rootOrder: string[],
  profileId: string,
  folderId: string | null,
): void {
  for (let i = 0; i < folders.length; i++) {
    const f = folders[i]
    if (!f) continue
    const has = f.profileIds.includes(profileId)
    const isTarget = folderId !== null && f.id === folderId
    if (!has && !isTarget) continue
    const profileIds = has ? f.profileIds.filter((id) => id !== profileId) : f.profileIds.slice()
    if (isTarget) profileIds.push(profileId)
    folders[i] = { ...f, profileIds }
  }
  const connKey = connTreeKey(profileId)
  const orderIdx = rootOrder.indexOf(connKey)
  if (orderIdx >= 0) rootOrder.splice(orderIdx, 1)
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

const foldersRef = ref<ConnFolder[]>([])
const rootOrderRef = ref<string[]>([])

let expandPersistTimer: ReturnType<typeof setTimeout> | null = null
let persistChain: Promise<void> = Promise.resolve()

function cancelExpandPersist(): void {
  if (expandPersistTimer === null) return
  clearTimeout(expandPersistTimer)
  expandPersistTimer = null
}

async function writeOrganization(): Promise<void> {
  if (!isBridgeAvailable()) {
    throw new Error('platform unavailable')
  }
  const payload = toOrganization(foldersRef.value, rootOrderRef.value)
  await withPlatformRetry(() => connectionApi.setOrganization({ organization: payload }))
}

/**
 * 串行写库，执行时读取当下内存，不是入队时的快照。
 * 新建/删除仍 await 自己这一笔；不是操作队列。
 */
async function persistOrganization(): Promise<void> {
  cancelExpandPersist()
  const next = persistChain.then(writeOrganization, writeOrganization)
  persistChain = next.then(
    () => undefined,
    () => undefined,
  )
  await next
}

function persistOrganizationSoon(): void {
  void persistOrganization().catch((error: unknown) => {
    console.warn('[conn-folders] platform save failed', error)
  })
}

function persistExpandedSoon(): void {
  cancelExpandPersist()
  expandPersistTimer = setTimeout(() => {
    expandPersistTimer = null
    persistOrganizationSoon()
  }, EXPAND_PERSIST_MS)
}

function snapshotOrg(): { folders: ConnFolder[]; rootOrder: string[] } {
  return {
    folders: foldersRef.value.map(cloneFolder),
    rootOrder: [...rootOrderRef.value],
  }
}

function restoreOrg(snap: { folders: ConnFolder[]; rootOrder: string[] }): void {
  foldersRef.value = snap.folders
  rootOrderRef.value = snap.rootOrder
}

function collectDescendantFolderIds(folders: readonly ConnFolder[], rootId: string): Set<string> {
  const toRemove = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const f of folders) {
      if (f.parentId && toRemove.has(f.parentId) && !toRemove.has(f.id)) {
        toRemove.add(f.id)
        changed = true
      }
    }
  }
  return toRemove
}

/** 删除文件夹子树，连接归入父文件夹，没有父级则插入原根位置。 */
export function applyFolderDelete(
  folders: ConnFolder[],
  rootOrder: string[],
  id: string,
): { folders: ConnFolder[]; rootOrder: string[] } {
  const toRemove = collectDescendantFolderIds(folders, id)
  const parentId = folders.find((f) => f.id === id)?.parentId ?? null
  const orphaned: string[] = []
  for (const f of folders) {
    if (toRemove.has(f.id)) orphaned.push(...f.profileIds)
  }

  const remaining = folders.filter((f) => !toRemove.has(f.id))
  const stillAssigned = new Set(remaining.flatMap((f) => f.profileIds))
  const orphans = orphaned.filter((pid) => !stillAssigned.has(pid))

  const rootIdx = rootOrder.indexOf(folderTreeKey(id))
  const nextOrder = rootOrder.filter((k) => {
    const parsed = parseTreeKey(k)
    return parsed.type !== 'folder' || !toRemove.has(parsed.id)
  })

  if (parentId) {
    const parentIdx = remaining.findIndex((f) => f.id === parentId)
    const parent = parentIdx >= 0 ? remaining[parentIdx] : undefined
    if (parent) {
      remaining[parentIdx] = { ...parent, profileIds: [...parent.profileIds, ...orphans] }
      return { folders: remaining, rootOrder: nextOrder }
    }
  }

  const orphanKeys = orphans.map((pid) => connTreeKey(pid))
  if (orphanKeys.length > 0) {
    if (rootIdx >= 0) nextOrder.splice(rootIdx, 0, ...orphanKeys)
    else nextOrder.push(...orphanKeys)
  }
  return { folders: remaining, rootOrder: nextOrder }
}

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

function topologicalFolders(
  folders: ConnectionExportOrganization['folders'],
): ConnectionExportOrganization['folders'] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const result: ConnectionExportOrganization['folders'] = []
  const visiting = new Set<string>()
  const done = new Set<string>()

  function visit(id: string): void {
    if (done.has(id) || !byId.has(id) || visiting.has(id)) return
    visiting.add(id)
    const f = byId.get(id)!
    if (f.parentId) visit(f.parentId)
    visiting.delete(id)
    done.add(id)
    result.push(f)
  }

  for (const f of folders) visit(f.id)
  return result
}

export function useConnFolders() {
  const folders = foldersRef
  const rootOrder = rootOrderRef

  const persist = persistOrganization
  const persistSoon = persistOrganizationSoon

  /** 从 SQLite 拉取组织层。先等进行中的写入结束，避免旧快照盖掉库。 */
  async function hydrate(): Promise<void> {
    if (!isBridgeAvailable()) {
      return
    }
    cancelExpandPersist()
    await persistChain
    try {
      const res = await withPlatformRetry(() => connectionApi.getOrganization({}))
      const remote = fromOrganization(res.organization)
      folders.value = remote.folders
      rootOrder.value = remote.rootOrder
    } catch (error) {
      console.warn('[conn-folders] platform load failed', error)
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
      persistSoon()
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
    persistSoon()
  }

  /** 按同级已有名称生成不重复的文件夹名。 */
  function nextFolderName(name: string, parentId: string | null = null, excludeId?: string): string {
    return nextFolderNameIn(folders.value, name, parentId, excludeId)
  }

  function addFolderInMemory(
    name: string,
    parentId: string | null,
    accentColor: ConnAccentColor,
    expanded: boolean,
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
    return folder
  }

  function applyMoveToFolder(profileId: string, folderId: string | null): void {
    const nextFolders = folders.value.slice()
    const nextOrder = rootOrder.value.slice()
    moveProfileOn(nextFolders, nextOrder, profileId, folderId)
    folders.value = nextFolders
    rootOrder.value = nextOrder
  }

  function applyDeleteFolder(id: string): void {
    const next = applyFolderDelete(folders.value, rootOrder.value, id)
    folders.value = next.folders
    rootOrder.value = next.rootOrder
  }

  async function createFolder(
    name: string,
    parentId: string | null = null,
    accentColor: ConnAccentColor = DEFAULT_FOLDER_ACCENT,
    expanded = true,
  ): Promise<ConnFolder> {
    const snap = snapshotOrg()
    const folder = addFolderInMemory(name, parentId, accentColor, expanded)
    try {
      await persist()
      return folder
    } catch (error) {
      restoreOrg(snap)
      throw error
    }
  }

  function renameFolder(id: string, name: string): void {
    updateFolder(id, { name })
  }

  function updateFolder(
    id: string,
    patch: { name?: string; accentColor?: ConnAccentColor },
  ): void {
    folders.value = folders.value.map((f) => (f.id === id ? { ...f, ...patch } : f))
    persistSoon()
  }

  async function deleteFolder(id: string): Promise<void> {
    const snap = snapshotOrg()
    applyDeleteFolder(id)
    try {
      await persist()
    } catch (error) {
      restoreOrg(snap)
      throw error
    }
  }

  /**
   * 导入包还原文件夹树：内存里一次建完再同步写库。
   * 失败回滚到导入前状态。
   */
  async function applyImportedOrganization(
    organization: ConnectionExportOrganization | null | undefined,
    idMap: Record<string, string>,
    fallbackName: string,
    nestUnderFolderId: string | null,
  ): Promise<void> {
    const snap = snapshotOrg()
    const nextFolders = folders.value.map(cloneFolder)
    const nextOrder = [...rootOrder.value]
    try {
      if (!organization?.folders?.length) {
        if (!nestUnderFolderId) return
        for (const newPid of Object.values(idMap)) {
          moveProfileOn(nextFolders, nextOrder, newPid, nestUnderFolderId)
        }
        folders.value = nextFolders
        rootOrder.value = nextOrder
        await persist()
        return
      }

      const folderIdMap = new Map<string, string>()
      for (const f of topologicalFolders(organization.folders)) {
        let parentId: string | null = null
        if (f.parentId && folderIdMap.has(f.parentId)) {
          parentId = folderIdMap.get(f.parentId)!
        } else if (!f.parentId && nestUnderFolderId) {
          parentId = nestUnderFolderId
        }
        const created: ConnFolder = {
          id: crypto.randomUUID(),
          name: nextFolderNameIn(nextFolders, f.name || fallbackName, parentId),
          expanded: f.expanded ?? true,
          profileIds: [],
          parentId,
          accentColor: (f.accentColor as ConnAccentColor | undefined) ?? DEFAULT_FOLDER_ACCENT,
        }
        nextFolders.push(created)
        if (!parentId) nextOrder.push(folderTreeKey(created.id))
        folderIdMap.set(f.id, created.id)
        for (const oldPid of f.profileIds) {
          const newPid = idMap[oldPid]
          if (newPid) moveProfileOn(nextFolders, nextOrder, newPid, created.id)
        }
      }

      const assigned = new Set(nextFolders.flatMap((f) => f.profileIds))
      for (const newPid of Object.values(idMap)) {
        if (assigned.has(newPid)) continue
        if (nestUnderFolderId) moveProfileOn(nextFolders, nextOrder, newPid, nestUnderFolderId)
      }
      folders.value = nextFolders
      rootOrder.value = nextOrder
      await persist()
    } catch (error) {
      restoreOrg(snap)
      throw error
    }
  }

  /**
   * 就地更新展开态并落盘，不替换 folders 数组，避免连接树整树重建。
   */
  function setFolderExpanded(id: string, expanded: boolean): void {
    const folder = folders.value.find((f) => f.id === id)
    if (!folder || folder.expanded === expanded) return
    folder.expanded = expanded
    persistExpandedSoon()
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
    if (changed) persistExpandedSoon()
  }

  function toggleFolder(id: string): void {
    const folder = folders.value.find((f) => f.id === id)
    if (!folder) return
    setFolderExpanded(id, !folder.expanded)
  }

  function moveToFolder(profileId: string, folderId: string | null): void {
    applyMoveToFolder(profileId, folderId)
    persistSoon()
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
    persistSoon()
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
      persistSoon()
    }
  }

  function reorderConnInFolder(
    profileId: string,
    targetProfileId: string,
    position: 'before' | 'after',
    folderId: string,
  ): void {
    folders.value = folders.value.map((f) => {
      if (f.id !== folderId) return f
      const ids = f.profileIds.filter((id) => id !== profileId)
      const targetIdx = ids.indexOf(targetProfileId)
      let insertAt = ids.length
      if (targetIdx >= 0) {
        insertAt = position === 'before' ? targetIdx : targetIdx + 1
      }
      ids.splice(insertAt, 0, profileId)
      return { ...f, profileIds: ids }
    })
    persistSoon()
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
    applyImportedOrganization,
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
