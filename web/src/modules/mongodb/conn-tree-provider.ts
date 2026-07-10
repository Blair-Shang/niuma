import type { ConnTreeChildProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnOpenContext, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { mongodbApi } from '@/api'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'

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
}
