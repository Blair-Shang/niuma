import type { ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import {
  buildConnectionTabTitle,
  redisDatabaseFromContext,
} from '@/modules/ops/connection-nav/utils'
import type { ConnectionNavStrategy, ConnectionNavTabSpec } from '@/modules/ops/connection-nav/types'
import type { WorkspaceTab } from '@/stores/tab'
import { kindIcon } from '@/modules/ops/types'

function buildRedisTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const database = redisDatabaseFromContext(ctx)
  const props: Record<string, unknown> = { profileId: item.profileId }
  if (database !== undefined) {
    props.database = database
  }
  return {
    moduleId: 'redis',
    title: buildConnectionTabTitle(item.profileName, database),
    icon: kindIcon('redis'),
    props,
  }
}

/**
 * Redis：允许多 Tab；同 profile + 同 DB 的 lease 在 L4 共享（session-policy scoped）。
 * 双击不同 DB 子节点时 `props.database` 不同，标题带 `· DBn`。
 */
export const redisConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'redis',
  dedupFocus: false,

  buildTabSpec: buildRedisTabSpec,

  // 预留：若将来改为同 DB 聚焦，设 dedupFocus: true 并启用下列匹配
  findExistingTab(tabs, spec) {
    const db = spec.props.database
    return tabs.find((tab) => {
      if (tab.moduleId !== 'redis' || tab.props.profileId !== spec.props.profileId) {
        return false
      }
      const tabDb = typeof tab.props.database === 'number' ? tab.props.database : undefined
      return tabDb === db
    })
  },
}
