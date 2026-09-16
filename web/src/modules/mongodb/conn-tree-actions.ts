/**
 * MongoDB 连接树菜单动作（按需 dynamic import，勿从启动注册路径静态引用）。
 */
import { i18n } from '@/locale'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { useMongoDdlActionStore } from '@/modules/mongodb/stores/ddl-actions'
import { isProtectedDatabase, isSystemCollection } from '@/modules/mongodb/utils/catalog-names'

function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params as Record<string, string>)
}

function segmentName(path: ConnResourcePath | undefined, kind: string): string | undefined {
  return path?.segments.find((segment) => segment.kind === kind)?.name
}

function databasePath(name: string): ConnResourcePath {
  return { segments: [{ kind: 'database', name }] }
}

function requestCreateDatabase(conn: ConnItem): void {
  useMongoDdlActionStore().request({
    conn,
    action: 'create_database',
    profileId: conn.profileId,
    name: '',
    title: t('modules.mongodb.tree.createDatabase'),
    description: t('modules.mongodb.ddl.createDatabaseDesc'),
    kind: 'create_database',
    createOptions: { collection: '' },
  })
}

function requestRenameDatabase(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'database')
  if (!name || isProtectedDatabase(name)) return

  useMongoDdlActionStore().request({
    conn,
    action: 'rename_database',
    profileId: conn.profileId,
    name,
    newName: name,
    title: t('modules.mongodb.tree.dbRename'),
    description: t('modules.mongodb.ddl.renameDatabaseDesc', { name }),
    kind: 'rename',
    prunePaths: [path],
  })
}

function requestRenameCollection(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  const collection = segmentName(path, 'collection')
  if (!database || !collection || isProtectedDatabase(database) || isSystemCollection(collection)) {
    return
  }

  useMongoDdlActionStore().request({
    conn,
    action: 'rename_collection',
    profileId: conn.profileId,
    database,
    name: collection,
    newName: collection,
    title: t('modules.mongodb.tree.collRename'),
    description: t('modules.mongodb.ddl.renameCollectionDesc', { name: collection }),
    kind: 'rename',
    refreshPath: databasePath(database),
    refreshDeep: false,
    prunePaths: [path],
  })
}

export function onConnMenuSelect(conn: ConnItem, key: string): boolean {
  if (key !== 'createDatabase') return false
  requestCreateDatabase(conn)
  return true
}

export function onResourceMenuSelect(conn: ConnItem, path: ConnResourcePath, key: string): boolean {
  if (key !== 'rename') return false
  const last = path.segments.at(-1)
  if (last?.kind === 'database') {
    requestRenameDatabase(conn, path)
    return true
  }
  if (last?.kind === 'collection') {
    requestRenameCollection(conn, path)
    return true
  }
  return false
}
