import type { ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import { buildConnectionTabTooltip, nextQueryTabIndex } from '@/modules/ops/connection-nav/utils'
import type { ConnectionNavStrategy, ConnectionNavTabSpec } from '@/modules/ops/connection-nav/types'
import type { WorkspaceTab } from '@/stores/tab'
import { useTabStore } from '@/stores/tab'
import { kindIcon } from '@/modules/ops/types'
import { i18n } from '@/locale'
import {
  clickhousePaneRegistry,
  normalizeClickHouseFeature,
  type ClickHouseSessionTab,
} from '@/modules/clickhouse/pane-registry'
import {
  objectKindIcon,
  type ClickHouseObjectKind,
  type ClickHouseObjectScriptMode,
} from '@/modules/clickhouse/types/object-script'

function segmentName(ctx: ConnOpenContext | undefined, kind: string): string | undefined {
  return ctx?.resourcePath?.segments.find((segment) => segment.kind === kind)?.name
}

function featureLabel(tab: ClickHouseSessionTab): string {
  return i18n.global.t(clickhousePaneRegistry[tab].labelKey)
}

function resolveDesignMode(ctx?: ConnOpenContext): ClickHouseObjectScriptMode {
  return ctx?.designMode === 'create' ? 'create' : 'alter'
}

function resolveObjectKind(ctx?: ConnOpenContext): ClickHouseObjectKind | undefined {
  if (
    ctx?.objectKind === 'view'
    || ctx?.objectKind === 'materializedView'
    || ctx?.objectKind === 'dictionary'
  ) {
    return ctx.objectKind
  }
  const category = segmentName(ctx, 'category')
  if (category === 'views') return 'view'
  if (category === 'materializedViews') return 'materializedView'
  if (category === 'dictionaries') return 'dictionary'
  return undefined
}

function resolveObjectName(ctx?: ConnOpenContext): string | undefined {
  return segmentName(ctx, 'table')
}

function objectScriptFeatureLabel(
  objectKind: ClickHouseObjectKind,
  designMode: ClickHouseObjectScriptMode,
): string {
  if (designMode === 'create') {
    if (objectKind === 'materializedView') {
      return i18n.global.t('modules.clickhouse.session.tabNewMaterializedView')
    }
    if (objectKind === 'dictionary') {
      return i18n.global.t('modules.clickhouse.session.tabNewDictionary')
    }
    return i18n.global.t('modules.clickhouse.session.tabNewView')
  }
  if (objectKind === 'materializedView') {
    return i18n.global.t('modules.clickhouse.session.tabMaterializedView')
  }
  if (objectKind === 'dictionary') {
    return i18n.global.t('modules.clickhouse.session.tabDictionary')
  }
  return i18n.global.t('modules.clickhouse.session.tabView')
}

function resolveFeature(ctx?: ConnOpenContext): ClickHouseSessionTab {
  if (ctx?.initialTab) return normalizeClickHouseFeature(ctx.initialTab)
  const category = segmentName(ctx, 'category')
  if (
    (category === 'views' || category === 'materializedViews' || category === 'dictionaries')
    && segmentName(ctx, 'table')
    && ctx?.designMode
  ) {
    return 'objectScript'
  }
  if (segmentName(ctx, 'table') && (category === 'tables' || category === 'views' || category === 'materializedViews')) {
    return 'browse'
  }
  return 'query'
}

function buildQueryTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || item.connectionOptions?.database
  const host = item.hostAddress || item.profileName
  const queryIndex = nextQueryTabIndex(useTabStore().allTabs, 'clickhouse', item.profileId, () => true)
  const queryTitle = i18n.global.t('modules.clickhouse.session.tabQueryIndexed', { n: queryIndex })

  const props: Record<string, unknown> = { profileId: item.profileId, initialTab: 'query' }
  if (typeof database === 'string' && database.trim()) props.database = database.trim()
  if (ctx?.initialSql?.trim()) props.initialSql = ctx.initialSql
  if (ctx?.autoRunInitialSql) props.autoRunInitialSql = true

  return {
    moduleId: 'clickhouse',
    title: `${(typeof database === 'string' && database.trim()) || host} · ${queryTitle}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, undefined, queryTitle),
    icon: kindIcon('clickhouse'),
    props,
  }
}

function buildRelationTabSpec(
  item: ConnItem,
  ctx: ConnOpenContext | undefined,
  feature: ClickHouseSessionTab,
): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || ''
  const table = segmentName(ctx, 'table') || ''
  const category = segmentName(ctx, 'category')
  const isView = category === 'views' || category === 'materializedViews'
  const label = featureLabel(feature)
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: feature,
    database,
    table,
    isView,
  }
  return {
    moduleId: 'clickhouse',
    title: `${table || database || item.profileName} · ${label}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, undefined, label),
    icon: clickhousePaneRegistry[feature].icon,
    props,
  }
}

function buildObjectScriptTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || ''
  const objectKind = resolveObjectKind(ctx) ?? 'view'
  const designMode = resolveDesignMode(ctx)
  const objectName = resolveObjectName(ctx)
  const featureTitle = objectScriptFeatureLabel(objectKind, designMode)
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'objectScript',
    objectKind,
    designMode,
    database,
  }
  if (objectName) {
    props.objectName = objectName
    props.table = objectName
    props.isView = true
  }
  if (ctx?.initialSql?.trim()) props.initialSql = ctx.initialSql

  return {
    moduleId: 'clickhouse',
    title: `${objectName || database || item.profileName} · ${featureTitle}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, undefined, featureTitle),
    icon: objectKindIcon(objectKind),
    props,
  }
}

function buildClickHouseTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const feature = resolveFeature(ctx)
  if (feature === 'query') return buildQueryTabSpec(item, ctx)
  if (feature === 'objectScript') return buildObjectScriptTabSpec(item, ctx)

  if (feature === 'monitor') {
    return {
      moduleId: 'clickhouse',
      title: `${item.hostAddress || item.profileName} · ${featureLabel('monitor')}`,
      tooltip: buildConnectionTabTooltip(
        item.profileName,
        item.hostAddress,
        undefined,
        featureLabel('monitor'),
      ),
      icon: kindIcon('clickhouse'),
      props: {
        profileId: item.profileId,
        initialTab: 'monitor',
      },
    }
  }

  if (feature === 'tools') {
    const fromPath = segmentName(ctx, 'database')?.trim() || ''
    const fromOpts =
      typeof item.connectionOptions?.database === 'string'
        ? item.connectionOptions.database.trim()
        : ''
    const database = fromPath || fromOpts
    const toolsLabel = featureLabel('tools')
    const props: Record<string, unknown> = {
      profileId: item.profileId,
      initialTab: 'tools',
    }
    if (database) props.database = database
    // 优先库名 / 站点名，避免 Tab 上堆主机地址
    const baseTitle = database || item.profileName || item.hostAddress || 'ClickHouse'
    return {
      moduleId: 'clickhouse',
      title: `${baseTitle} · ${toolsLabel}`,
      tooltip: buildConnectionTabTooltip(
        item.profileName,
        item.hostAddress,
        database || undefined,
        toolsLabel,
      ),
      icon: clickhousePaneRegistry.tools.icon,
      props,
    }
  }

  if (feature === 'design') {
    const database = segmentName(ctx, 'database') || ''
    const table = segmentName(ctx, 'table') || ''
    const designMode = resolveDesignMode(ctx)
    const host = item.hostAddress || item.profileName
    const baseTitle =
      designMode === 'create'
        ? i18n.global.t('modules.clickhouse.session.tabNewTable')
        : database && table
          ? `${database}.${table}`
          : database || host
    const props: Record<string, unknown> = {
      profileId: item.profileId,
      initialTab: 'design',
      designMode,
      database,
    }
    if (table) props.table = table
    return {
      moduleId: 'clickhouse',
      title: `${baseTitle} · ${featureLabel('design')}`,
      tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, undefined, featureLabel('design')),
      icon: clickhousePaneRegistry.design.icon,
      props,
    }
  }

  return buildRelationTabSpec(item, ctx, feature)
}

function findExistingRelationTab(
  tabs: readonly WorkspaceTab[],
  item: ConnItem,
  ctx: ConnOpenContext | undefined,
  feature: ClickHouseSessionTab,
): WorkspaceTab | undefined {
  const database = segmentName(ctx, 'database')
  const table = segmentName(ctx, 'table')
  return tabs.find((tab) => {
    if (tab.moduleId !== 'clickhouse') return false
    const p = tab.props as Record<string, unknown>
    return (
      p.profileId === item.profileId
      && p.initialTab === feature
      && p.database === database
      && p.table === table
    )
  })
}

export const clickhouseConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'clickhouse',
  dedupFocus: true,
  buildTabSpec: buildClickHouseTabSpec,
  findExistingTab(tabs, _spec, item, ctx) {
    const feature = resolveFeature(ctx)
    if (feature === 'query') return undefined
    if (feature === 'monitor') {
      return tabs.find(
        (tab) =>
          tab.moduleId === 'clickhouse'
          && tab.props.profileId === item.profileId
          && tab.props.initialTab === 'monitor',
      )
    }
    if (feature === 'tools') {
      return tabs.find(
        (tab) =>
          tab.moduleId === 'clickhouse'
          && tab.props.profileId === item.profileId
          && tab.props.initialTab === 'tools',
      )
    }
    if (feature === 'design') {
      const database = segmentName(ctx, 'database')
      const table = segmentName(ctx, 'table')
      const designMode = resolveDesignMode(ctx)
      return tabs.find((tab) => {
        if (tab.moduleId !== 'clickhouse' || tab.props.profileId !== item.profileId) return false
        if (tab.props.initialTab !== 'design') return false
        const tabDb = typeof tab.props.database === 'string' ? tab.props.database : undefined
        const tabTable = typeof tab.props.table === 'string' ? tab.props.table : undefined
        const tabMode = tab.props.designMode === 'create' ? 'create' : 'alter'
        return tabDb === database && tabTable === table && tabMode === designMode
      })
    }
    if (feature === 'objectScript') {
      const database = segmentName(ctx, 'database')
      const objectKind = resolveObjectKind(ctx) ?? 'view'
      const objectName = resolveObjectName(ctx)
      const designMode = resolveDesignMode(ctx)
      return tabs.find((tab) => {
        if (tab.moduleId !== 'clickhouse' || tab.props.profileId !== item.profileId) return false
        if (tab.props.initialTab !== 'objectScript') return false
        const tabDb = typeof tab.props.database === 'string' ? tab.props.database : undefined
        const tabKind = tab.props.objectKind
        const tabName =
          typeof tab.props.objectName === 'string'
            ? tab.props.objectName
            : typeof tab.props.table === 'string'
              ? tab.props.table
              : undefined
        const tabMode = tab.props.designMode === 'create' ? 'create' : 'alter'
        return (
          tabDb === database
          && tabKind === objectKind
          && tabName === objectName
          && tabMode === designMode
        )
      })
    }
    return findExistingRelationTab(tabs, item, ctx, feature)
  },
}
