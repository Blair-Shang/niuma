import type { RsContextMenuItem } from '@niuma/ui'
import type { ConnTreeChildProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnOpenContext, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { mongodbApi } from '@/api'
import { i18n } from '@/locale'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnItem } from '@/modules/ops/types'

function t(key: string): string {
  return i18n.global.t(key)
}

function databaseNameFromPath(path?: ConnResourcePath): string | undefined {
  return path?.segments.find((s) => s.kind === 'database')?.name
}

function formatSize(bytes: number): string {
  if (bytes <= 0) {
    return ''
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** MongoDB 连接树 Provider：database → collection 两级懒加载。 */
export const mongoConnTreeProvider: ConnTreeChildProvider = {
  canExpand() {
    return true
  },

  async loadChildren(conn, parentPath) {
    const database = databaseNameFromPath(parentPath)
    if (database) {
      try {
        const result = await mongodbApi.treeCollections({ profileId: conn.profileId, database })
        return result.collections.map((coll) => ({
          path: {
            segments: [
              { kind: 'database', name: database },
              { kind: 'collection', name: coll.name },
            ],
          },
          label: coll.name,
          icon: 'table',
          badge: coll.count !== undefined ? String(coll.count) : undefined,
          collapsible: false,
        }))
      } catch {
        return []
      }
    }

    try {
      const result = await mongodbApi.treeDatabases({ profileId: conn.profileId })
      return result.databases.map((db) => ({
        path: { segments: [{ kind: 'database', name: db.name }] },
        label: db.name,
        icon: 'database',
        badge: db.empty ? undefined : formatSize(db.sizeOnDisk),
        collapsible: true,
      }))
    } catch {
      return []
    }
  },

  activate(conn, path) {
    const ctx: ConnOpenContext = { resourcePath: path }
    useConnectionNavigation().connect(conn, ctx)
  },

  connMenuItems(): RsContextMenuItem[] {
    return [{ key: 'console', label: t('modules.mongodb.tree.connConsole'), icon: 'terminal' }]
  },

  onConnMenuSelect(conn: ConnItem, key: string): boolean {
    if (key !== 'console') {
      return false
    }
    useConnectionNavigation().connect(conn, { initialTab: 'console' })
    return true
  },

  resourceMenuItems(_conn: ConnItem, path: ConnResourcePath): RsContextMenuItem[] {
    const isDatabase = path.segments.length === 1 && path.segments[0].kind === 'database'
    const isCollection = path.segments.length === 2 && path.segments[1].kind === 'collection'

    if (isDatabase) {
      return [
        { key: 'open', label: t('modules.mongodb.tree.dbOpen'), icon: 'database' },
        { key: 'sep-query', label: '', separator: true },
        { key: 'query', label: t('modules.mongodb.tree.collQuery'), icon: 'code-2' },
        { key: 'sep-server', label: '', separator: true },
        { key: 'monitor', label: t('modules.mongodb.tree.dbMonitor'), icon: 'activity' },
      ]
    }

    if (isCollection) {
      return [
        { key: 'open', label: t('modules.mongodb.tree.collOpen'), icon: 'table-2' },
        { key: 'sep-query', label: '', separator: true },
        { key: 'query', label: t('modules.mongodb.tree.collQuery'), icon: 'code-2' },
        { key: 'schema', label: t('modules.mongodb.tree.collSchema'), icon: 'list-tree' },
        { key: 'indexes', label: t('modules.mongodb.tree.collIndexes'), icon: 'list-ordered' },
        { key: 'sep-tools', label: '', separator: true },
        { key: 'live', label: t('modules.mongodb.tree.collLive'), icon: 'radio' },
        { key: 'tools', label: t('modules.mongodb.tree.collTools'), icon: 'wrench' },
      ]
    }

    return []
  },

  onResourceMenuSelect(conn: ConnItem, path: ConnResourcePath, key: string): void {
    const nav = useConnectionNavigation()

    switch (key) {
      case 'open':
        nav.connect(conn, { resourcePath: path })
        break
      case 'query':
        nav.connect(conn, { resourcePath: path, initialTab: 'query' })
        break
      case 'schema':
        nav.connect(conn, { resourcePath: path, initialTab: 'schema' })
        break
      case 'indexes':
        nav.connect(conn, { resourcePath: path, initialTab: 'indexes' })
        break
      case 'live':
        nav.connect(conn, { resourcePath: path, initialTab: 'live' })
        break
      case 'tools':
        nav.connect(conn, { resourcePath: path, initialTab: 'tools' })
        break
      case 'monitor':
        nav.connect(conn, { resourcePath: path, initialTab: 'monitor' })
        break
    }
  },
}
