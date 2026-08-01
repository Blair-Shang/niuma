/**
 * 连接 / 文件夹导入导出。
 * 连接配置由 platform.connection.export|import 读写本机文件；
 * 文件夹组织层（localStorage）由前端随 organization 透传并还原。
 */
import { connectionApi, dialogApi } from '@/api'
import type { ConnectionExportOrganization } from '@/api/types/connection'
import { folderTreeKey, parseTreeKey } from '@/modules/ops/conn-tree/keys'
import {
  isFolderUnder,
  type ConnFolder,
  type ConnFolderMutations,
} from '@/modules/ops/composables/useConnFolders'
import type { ConnAccentColor, ConnItem } from '@/modules/ops/types'

const FILE_ACCEPT = ['.json']
const DEFAULT_EXPORT_NAME = 'niuma-connections.json'

export type ConnImportExportResult =
  | { ok: true; imported?: number; exported?: number }
  | { ok: false; canceled: true }
  | { ok: false; canceled?: false; error: string }

export type ConnExportScope =
  | { type: 'all' }
  | { type: 'folder'; folderId: string }
  | { type: 'connection'; profileId: string }

function collectFolderSubtreeIds(
  folders: readonly ConnFolder[],
  rootFolderId: string,
): Set<string> {
  const ids = new Set<string>([rootFolderId])
  for (const f of folders) {
    if (f.id !== rootFolderId && isFolderUnder(folders, f.id, rootFolderId)) {
      ids.add(f.id)
    }
  }
  return ids
}

function resolveExportParentId(
  folder: ConnFolder,
  exportRootId: string,
  folderIds: ReadonlySet<string>,
): string | null {
  if (folder.id === exportRootId) return null
  if (folder.parentId && folderIds.has(folder.parentId)) return folder.parentId
  return null
}

function defaultExportFileName(scope: ConnExportScope): string {
  if (scope.type === 'connection') return `niuma-connection-${scope.profileId}.json`
  if (scope.type === 'folder') return `niuma-folder-${scope.folderId}.json`
  return DEFAULT_EXPORT_NAME
}

function buildOrganizationForScope(
  scope: ConnExportScope,
  folders: readonly ConnFolder[],
  rootOrder: readonly string[],
  allProfileIds: ReadonlySet<string>,
): { profileIds: string[]; organization: ConnectionExportOrganization | null } {
  if (scope.type === 'connection') {
    if (!allProfileIds.has(scope.profileId)) {
      return { profileIds: [], organization: null }
    }
    return {
      profileIds: [scope.profileId],
      organization: null,
    }
  }

  if (scope.type === 'folder') {
    const folderIds = collectFolderSubtreeIds(folders, scope.folderId)
    const normalized = folders
      .filter((f) => folderIds.has(f.id))
      .map((f) => ({
        id: f.id,
        name: f.name,
        // 导出根升为顶层；子文件夹仅保留仍在导出集合内的父引用
        parentId: resolveExportParentId(f, scope.folderId, folderIds),
        profileIds: f.profileIds.filter((id) => allProfileIds.has(id)),
        accentColor: f.accentColor,
      }))
    const profileIds = [...new Set(normalized.flatMap((f) => f.profileIds))]
    return {
      profileIds,
      organization: {
        folders: normalized,
        rootOrder: [folderTreeKey(scope.folderId)],
      },
    }
  }

  const profileIds = [...allProfileIds]
  return {
    profileIds,
    organization: {
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        profileIds: f.profileIds.filter((id) => allProfileIds.has(id)),
        accentColor: f.accentColor,
      })),
      rootOrder: rootOrder.filter((key) => {
        const parsed = parseTreeKey(key)
        if (parsed.type === 'folder') {
          return folders.some((f) => f.id === parsed.id && !f.parentId)
        }
        return allProfileIds.has(parsed.id)
      }),
    },
  }
}

function restoreOrganization(
  organization: ConnectionExportOrganization | null | undefined,
  idMap: Record<string, string>,
  cf: ConnFolderMutations,
  fallbackName: string,
  nestUnderFolderId: string | null,
): void {
  if (!organization?.folders?.length) {
    if (nestUnderFolderId) {
      for (const newPid of Object.values(idMap)) {
        cf.moveToFolder(newPid, nestUnderFolderId)
      }
    }
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
    const created = cf.createFolder(
      f.name || fallbackName,
      parentId,
      f.accentColor as ConnAccentColor | undefined,
    )
    folderIdMap.set(f.id, created.id)
    for (const oldPid of f.profileIds) {
      const newPid = idMap[oldPid]
      if (newPid) cf.moveToFolder(newPid, created.id)
    }
  }

  const assigned = new Set(cf.folders.value.flatMap((f) => f.profileIds))
  for (const newPid of Object.values(idMap)) {
    if (assigned.has(newPid)) continue
    if (nestUnderFolderId) cf.moveToFolder(newPid, nestUnderFolderId)
  }
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

function mapPlatformError(e: unknown, fallback: string, t: (key: string) => string): string {
  const msg = e instanceof Error && e.message ? e.message : ''
  if (msg.includes('passphrase required')) return t('opsNav.io.passphraseNeeded')
  if (msg.includes('invalid passphrase')) return t('opsNav.io.passphraseInvalid')
  if (msg.includes('no profiles imported')) return t('opsNav.io.importNone')
  if (msg.includes('no profiles to export')) return t('opsNav.exportEmpty')
  if (msg.includes('no profiles in bundle')) return t('opsNav.importEmpty')
  if (msg.includes('invalid connection bundle')) return t('opsNav.importInvalid')
  if (msg.includes('unsupported connection bundle version')) return t('opsNav.importUnsupported')
  return msg || fallback
}

export type ConnIoCredentials = {
  includeSecrets: boolean
  passphrase: string
}

export function useConnImportExport(deps: {
  getProfiles: () => readonly ConnItem[]
  folders: ConnFolderMutations
  reloadProfiles: () => Promise<void>
  t: (key: string, params?: Record<string, unknown>) => string
}) {
  async function exportConnections(
    scope: ConnExportScope | undefined,
    credentials: ConnIoCredentials,
  ): Promise<ConnImportExportResult> {
    const resolved: ConnExportScope = scope ?? { type: 'all' }
    const profiles = deps.getProfiles()
    const allIds = new Set(profiles.map((p) => p.profileId))
    const { profileIds, organization } = buildOrganizationForScope(
      resolved,
      deps.folders.folders.value,
      deps.folders.rootOrder.value,
      allIds,
    )

    if (profileIds.length === 0) {
      return { ok: false, error: deps.t('opsNav.exportEmpty') }
    }

    const picked = await dialogApi.saveFile({
      title: deps.t('opsNav.exportConnections'),
      defaultPath: defaultExportFileName(resolved),
      accept: FILE_ACCEPT,
    })
    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false, canceled: true }
    }

    try {
      const res = await connectionApi.export({
        path: picked.filePaths[0],
        profileIds,
        organization,
        includeSecrets: credentials.includeSecrets,
        passphrase: credentials.includeSecrets ? credentials.passphrase : undefined,
      })
      return { ok: true, exported: res.exported }
    } catch (e) {
      return { ok: false, error: mapPlatformError(e, deps.t('opsNav.exportError'), deps.t) }
    }
  }

  async function importConnections(
    nestUnderFolderId: string | null,
    credentials: ConnIoCredentials,
  ): Promise<ConnImportExportResult> {
    const picked = await dialogApi.openFile({
      title: deps.t('opsNav.importConnections'),
      accept: FILE_ACCEPT,
      multiple: false,
    })
    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false, canceled: true }
    }

    try {
      const res = await connectionApi.import({
        path: picked.filePaths[0],
        passphrase: credentials.passphrase.trim() || undefined,
      })
      restoreOrganization(
        res.organization,
        res.idMap ?? {},
        deps.folders,
        deps.t('opsNav.newFolder'),
        nestUnderFolderId,
      )
      await deps.reloadProfiles()
      deps.folders.syncRootOrder([...deps.getProfiles()])
      return { ok: true, imported: res.imported }
    } catch (e) {
      return { ok: false, error: mapPlatformError(e, deps.t('opsNav.importError'), deps.t) }
    }
  }

  return { exportConnections, importConnections }
}
