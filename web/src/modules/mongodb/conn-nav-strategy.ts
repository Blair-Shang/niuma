import type { ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import {
  buildConnectionTabTitle,
  mongoResourceFromContext,
} from '@/modules/ops/connection-nav/utils'
import type { ConnectionNavStrategy, ConnectionNavTabSpec } from '@/modules/ops/connection-nav/types'
import type { WorkspaceTab } from '@/stores/tab'
import { kindIcon } from '@/modules/ops/types'

function buildMongoTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const mongo = mongoResourceFromContext(ctx)
  const props: Record<string, unknown> = { profileId: item.profileId }
  if (mongo.database) {
    props.database = mongo.database
  }
  if (mongo.collection) {
    props.collection = mongo.collection
  }
  return {
    moduleId: 'mongodb',
    title: buildConnectionTabTitle(item.profileName, undefined, mongo),
    icon: kindIcon('mongodb'),
    props,
  }
}

function mongoTabsMatch(
  tab: WorkspaceTab,
  profileId: string,
  mongo: { database?: string; collection?: string },
): boolean {
  if (tab.moduleId !== 'mongodb' || tab.props.profileId !== profileId) {
    return false
  }
  const tabDb = typeof tab.props.database === 'string' ? tab.props.database : undefined
  const tabColl = typeof tab.props.collection === 'string' ? tab.props.collection : undefined
  return tabDb === mongo.database && tabColl === mongo.collection
}

/**
 * MongoDB：同 profile + 同库 + 同集合 → 聚焦已有 Tab；否则新建。
 * 物理连接在同 profile 多 Tab 间共享（session-policy per_profile）。
 */
export const mongodbConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'mongodb',
  dedupFocus: true,

  buildTabSpec: buildMongoTabSpec,

  findExistingTab(tabs, _spec, item, ctx) {
    const mongo = mongoResourceFromContext(ctx)
    return tabs.find((tab) => mongoTabsMatch(tab, item.profileId, mongo))
  },
}
