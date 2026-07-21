import { connKindHasTree } from '@/modules/ops/conn-kind-loaders'
import { connTreeKey, resourceTreeKey } from '@/modules/ops/conn-tree/keys'
import { getConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnTreeTabSyncStrategy } from '@/modules/ops/conn-tree/tab-sync'
import type { ConnItem } from '@/modules/ops/types'
import { readRedisDatabaseFromOptions } from '@/modules/redis/composables/useRedisDatabase'
import type { WorkspaceTab } from '@/stores/tab'

function redisDbResourceKey(profileId: string, db: number): string {
  return resourceTreeKey(profileId, { segments: [{ kind: 'db', name: String(db) }] })
}

function resolveRedisTabDb(
  profiles: readonly ConnItem[],
  profileId: string,
  tabDatabase: unknown,
): number | null {
  const conn = profiles.find((p) => p.profileId === profileId && p.kind === 'redis')
  if (!conn) {
    return null
  }
  const provider = getConnTreeProvider('redis')
  if (!provider?.canExpand(conn) && !connKindHasTree('redis')) {
    return null
  }
  if (typeof tabDatabase === 'number') {
    return tabDatabase
  }
  return readRedisDatabaseFromOptions(conn.connectionOptions).database
}

/**
 * Redis：活跃 Session Tab 与侧栏 DB 子节点对齐。
 * Tab 带 `props.database` 时聚焦 `db` 资源节点，否则回落到连接根或 profile 默认库。
 */
export const redisConnTreeTabSync: ConnTreeTabSyncStrategy = {
  kind: 'redis',

  resolveFocusKey(tab: WorkspaceTab, { profiles }) {
    if (tab.moduleId !== 'redis') {
      return null
    }
    const profileId = tab.props.profileId
    if (typeof profileId !== 'string' || !profileId) {
      return null
    }
    const db = resolveRedisTabDb(profiles, profileId, tab.props.database)
    if (db === null) {
      return connTreeKey(profileId)
    }
    return redisDbResourceKey(profileId, db)
  },
}
