import type { ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import {
  buildConnectionTabTooltip,
  mongoResourceFromContext,
} from '@/modules/ops/connection-nav/utils'
import type { ConnectionNavStrategy, ConnectionNavTabSpec } from '@/modules/ops/connection-nav/types'
import type { WorkspaceTab } from '@/stores/tab'
import { kindIcon } from '@/modules/ops/types'
import { i18n } from '@/locale'
import type { MongoSessionTab } from '@/modules/mongodb/pane-registry'

/** 功能 → 工作区 Tab 标题后缀的 i18n key */
const FEATURE_LABEL_KEYS: Record<MongoSessionTab, string> = {
  collections: 'modules.mongodb.session.tabCollections',
  query: 'modules.mongodb.session.tabQuery',
  schema: 'modules.mongodb.session.tabSchema',
  indexes: 'modules.mongodb.session.tabIndexes',
  live: 'modules.mongodb.session.tabLive',
  tools: 'modules.mongodb.session.tabTools',
  console: 'modules.mongodb.session.tabConsole',
  monitor: 'modules.mongodb.session.tabMonitor',
}

function featureLabel(tab: string | undefined): string {
  if (!tab || tab === 'collections') return ''
  const key = FEATURE_LABEL_KEYS[tab as MongoSessionTab]
  return key ? i18n.global.t(key) : ''
}

/** 规范化 initialTab：undefined / 'collections' 都视为默认文档浏览 */
function normalizeFeature(tab: string | undefined): MongoSessionTab {
  return (tab as MongoSessionTab) ?? 'collections'
}

/** 主连接（无库/集合 scope）默认打开控制台；有资源路径时默认文档浏览。 */
function resolveFeature(ctx?: ConnOpenContext): MongoSessionTab {
  if (ctx?.initialTab) {
    return normalizeFeature(ctx.initialTab)
  }
  const mongo = mongoResourceFromContext(ctx)
  if (!mongo.database) {
    return 'console'
  }
  return 'collections'
}

function buildMongoTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const mongo = mongoResourceFromContext(ctx)
  const feature = resolveFeature(ctx)

  const props: Record<string, unknown> = { profileId: item.profileId }
  // 控制台绑定连接根（per_profile 单例），不携带库/集合 scope，避免多 Tab 争用 mongosh。
  if (feature === 'console') {
    props.initialTab = 'console'
  } else {
    if (mongo.database) props.database = mongo.database
    if (mongo.collection) props.collection = mongo.collection
    if (feature !== 'collections') props.initialTab = feature
  }

  // Tab 标题：库.集合（或连接名），加功能后缀（文档浏览不加）
  let baseTitle: string
  if (feature === 'console') {
    baseTitle = item.profileName
  } else if (mongo.database) {
    baseTitle = mongo.collection ? `${mongo.database}.${mongo.collection}` : mongo.database
  } else {
    baseTitle = item.profileName
  }
  const suffix = featureLabel(feature)
  const title = suffix ? `${baseTitle} · ${suffix}` : baseTitle

  const tooltip =
    feature === 'console'
      ? buildConnectionTabTooltip(item.profileName, item.hostAddress)
      : buildConnectionTabTooltip(item.profileName, item.hostAddress, mongo)

  return {
    moduleId: 'mongodb',
    title,
    tooltip,
    icon: kindIcon('mongodb'),
    props,
  }
}

/**
 * Tab 去重匹配：profileId + database + collection + feature 四元组一致才聚焦已有 Tab。
 * 同一集合的"文档浏览"和"聚合查询"是两个不同 Tab。
 */
function mongoTabsMatch(
  tab: WorkspaceTab,
  profileId: string,
  mongo: { database?: string; collection?: string },
  feature: MongoSessionTab,
): boolean {
  if (tab.moduleId !== 'mongodb' || tab.props.profileId !== profileId) {
    return false
  }
  const tabFeature = normalizeFeature(
    typeof tab.props.initialTab === 'string' ? tab.props.initialTab : undefined,
  )
  if (feature === 'console') {
    return tabFeature === 'console'
  }
  const tabDb = typeof tab.props.database === 'string' ? tab.props.database : undefined
  const tabColl = typeof tab.props.collection === 'string' ? tab.props.collection : undefined
  return tabDb === mongo.database && tabColl === mongo.collection && tabFeature === feature
}

/**
 * MongoDB：同 profile + 同库 + 同集合 + 同功能 → 聚焦已有 Tab；否则新建。
 * 物理连接在同 profile 多 Tab 间共享（session-policy per_profile）。
 */
export const mongodbConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'mongodb',
  dedupFocus: true,

  buildTabSpec: buildMongoTabSpec,

  findExistingTab(tabs, _spec, item, ctx) {
    const mongo = mongoResourceFromContext(ctx)
    const feature = resolveFeature(ctx)
    return tabs.find((tab) => mongoTabsMatch(tab, item.profileId, mongo, feature))
  },
}
