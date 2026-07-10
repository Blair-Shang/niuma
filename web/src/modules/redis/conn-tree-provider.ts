import type { ConnTreeChildProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import { readRedisDatabaseFromOptions } from '@/modules/redis/composables/useRedisDatabase'
import { redisApi } from '@/api'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'

const FALLBACK_DB_COUNT = 16

function buildDatabaseIndexes(
  databaseCount: number,
  defaultDb: number,
  keyspaceDbs: number[],
): number[] {
  const count = databaseCount > 0 ? databaseCount : FALLBACK_DB_COUNT
  let max = count
  max = Math.max(max, defaultDb + 1)
  for (const db of keyspaceDbs) {
    max = Math.max(max, db + 1)
  }
  return Array.from({ length: max }, (_, i) => i)
}

function formatKeyBadge(keyByDb: Map<number, number>, db: number): string {
  return String(keyByDb.get(db) ?? 0)
}

function fallbackDbIndexes(defaultDb: number): number[] {
  return buildDatabaseIndexes(FALLBACK_DB_COUNT, defaultDb, [])
}

/** Redis 连接树 Provider：展开显示逻辑库列表。 */
export const redisConnTreeProvider: ConnTreeChildProvider = {
  canExpand(conn) {
    const { topology } = readRedisDatabaseFromOptions(conn.connectionOptions)
    return topology !== 'cluster'
  },

  async loadChildren(conn) {
    const { database: defaultDb } = readRedisDatabaseFromOptions(conn.connectionOptions)
    try {
      const result = await redisApi.treeDatabases({ profileId: conn.profileId })
      const keyByDb = new Map(result.keyspace.map((item) => [item.db, item.keys]))
      const keyspaceDbs = result.keyspace.map((item) => item.db)
      const indexes = buildDatabaseIndexes(result.databaseCount, result.defaultDatabase, keyspaceDbs)
      if (indexes.length === 0) {
        return fallbackDbIndexes(defaultDb).map((db) => ({
          path: { segments: [{ kind: 'db', name: String(db) }] },
          label: `DB ${db}`,
          icon: 'database',
          badge: '0',
          collapsible: false,
        }))
      }
      return indexes.map((db) => ({
        path: { segments: [{ kind: 'db', name: String(db) }] },
        label: `DB ${db}`,
        icon: 'database',
        badge: formatKeyBadge(keyByDb, db),
        collapsible: false,
      }))
    } catch {
      return fallbackDbIndexes(defaultDb).map((db) => ({
        path: { segments: [{ kind: 'db', name: String(db) }] },
        label: `DB ${db}`,
        icon: 'database',
        collapsible: false,
      }))
    }
  },

  activate(conn, path) {
    const ctx: ConnOpenContext = { resourcePath: path }
    useConnectionNavigation().connect(conn, ctx)
  },
}
