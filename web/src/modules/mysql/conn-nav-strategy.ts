import type { ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import {
  buildConnectionTabTooltip,
  nextQueryTabIndex,
} from '@/modules/ops/connection-nav/utils'
import type { ConnectionNavStrategy, ConnectionNavTabSpec } from '@/modules/ops/connection-nav/types'
import type { WorkspaceTab } from '@/stores/tab'
import { useTabStore } from '@/stores/tab'
import { kindIcon } from '@/modules/ops/types'
import { i18n } from '@/locale'
import {
  mysqlPaneRegistry,
  normalizeMysqlFeature,
  type MysqlSessionTab,
} from '@/modules/mysql/pane-registry'
import type { MysqlObjectKind } from '@/modules/mysql/types/object-script'
import { objectKindIcon } from '@/modules/mysql/types/object-script'

function segmentName(ctx: ConnOpenContext | undefined, kind: string): string | undefined {
  const seg = ctx?.resourcePath?.segments.find((s) => s.kind === kind)
  return seg?.name
}

function resolveDesignMode(ctx?: ConnOpenContext): 'create' | 'alter' {
  return ctx?.designMode === 'create' ? 'create' : 'alter'
}

function resolveObjectKind(ctx?: ConnOpenContext): MysqlObjectKind | undefined {
  const kind = ctx?.objectKind
  if (kind === 'view' || kind === 'procedure' || kind === 'function') return kind
  const category = segmentName(ctx, 'category')
  if (category === 'views') return 'view'
  if (category === 'procedures') return 'procedure'
  if (category === 'functions') return 'function'
  return undefined
}

function resolveObjectName(ctx?: ConnOpenContext, objectKind?: MysqlObjectKind): string | undefined {
  if (objectKind === 'view') return segmentName(ctx, 'table')
  if (objectKind === 'procedure' || objectKind === 'function') {
    return segmentName(ctx, 'routine')
  }
  return segmentName(ctx, 'table') ?? segmentName(ctx, 'routine')
}

function objectScriptFeatureLabel(
  objectKind: MysqlObjectKind | undefined,
  designMode: 'create' | 'alter',
): string {
  if (designMode === 'create') {
    if (objectKind === 'procedure') {
      return i18n.global.t('modules.mysql.session.tabNewProcedure')
    }
    if (objectKind === 'function') {
      return i18n.global.t('modules.mysql.session.tabNewFunction')
    }
    return i18n.global.t('modules.mysql.session.tabNewView')
  }
  if (objectKind === 'procedure') {
    return i18n.global.t('modules.mysql.session.tabProcedure')
  }
  if (objectKind === 'function') {
    return i18n.global.t('modules.mysql.session.tabFunction')
  }
  return i18n.global.t('modules.mysql.session.tabView')
}

function featureLabel(tab: MysqlSessionTab, routineKind?: 'function' | 'procedure'): string {
  if (tab === 'objectScript') {
    return i18n.global.t(
      routineKind === 'procedure'
        ? 'modules.mysql.session.tabProcedure'
        : 'modules.mysql.session.tabFunction',
    )
  }
  return i18n.global.t(mysqlPaneRegistry[tab].labelKey)
}

function resolveFeature(ctx?: ConnOpenContext): MysqlSessionTab {
  if (ctx?.initialTab) {
    return normalizeMysqlFeature(ctx.initialTab)
  }
  if (segmentName(ctx, 'routine')) return 'objectScript'
  if (segmentName(ctx, 'table')) return 'browse'
  return 'query'
}

function resolveRoutineKind(
  ctx?: ConnOpenContext,
): 'procedure' | 'function' | undefined {
  const kind = resolveObjectKind(ctx)
  if (kind === 'procedure' || kind === 'function') return kind
  const category = segmentName(ctx, 'category')
  if (category === 'procedures') return 'procedure'
  if (category === 'functions') return 'function'
  return undefined
}

function buildQueryTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const fromPath = segmentName(ctx, 'database')
  const fromProfile = item.connectionOptions?.database
  const database =
    fromPath ||
    (typeof fromProfile === 'string' && fromProfile.trim() ? fromProfile.trim() : undefined)

  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'query',
  }
  if (database) props.database = database
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }
  if (ctx?.autoRunInitialSql) {
    props.autoRunInitialSql = true
  }

  let baseTitle = item.profileName
  if (database) baseTitle = database

  const queryIndex = nextQueryTabIndex(
    useTabStore().allTabs,
    'mysql',
    item.profileId,
    (initialTab) =>
      normalizeMysqlFeature(typeof initialTab === 'string' ? initialTab : undefined) === 'query',
  )
  const queryTitle = i18n.global.t('modules.mysql.session.tabQueryIndexed', { n: queryIndex })

  return {
    moduleId: 'mysql',
    title: `${baseTitle} · ${queryTitle}`,
    tooltip: buildConnectionTabTooltip(
      item.profileName,
      item.hostAddress,
      database || undefined,
      queryTitle,
    ),
    icon: kindIcon('mysql'),
    props,
  }
}

function buildObjectScriptTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database')
  const objectKind = resolveObjectKind(ctx) ?? 'view'
  const designMode = resolveDesignMode(ctx)
  const objectName = resolveObjectName(ctx, objectKind)
  const featureTitle = objectScriptFeatureLabel(objectKind, designMode)

  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'objectScript',
    objectKind,
    designMode,
  }
  if (database) props.database = database
  if (objectName) props.objectName = objectName
  if (objectKind === 'view' && objectName) props.table = objectName
  if ((objectKind === 'procedure' || objectKind === 'function') && objectName) {
    props.routine = objectName
    props.routineKind = objectKind
  }
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }

  const resource =
    database && objectName ? `${database}.${objectName}` : database || undefined
  // Tab 只显示对象名；完整库.对象放 tip
  const title = objectName || featureTitle

  return {
    moduleId: 'mysql',
    title,
    tooltip: buildConnectionTabTooltip(
      item.profileName,
      item.hostAddress,
      resource,
      featureTitle,
    ),
    icon: objectKindIcon(objectKind),
    props,
  }
}

function buildMysqlTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const feature = resolveFeature(ctx)
  if (feature === 'query') {
    return buildQueryTabSpec(item, ctx)
  }

  if (feature === 'objectScript') {
    return buildObjectScriptTabSpec(item, ctx)
  }

  if (feature === 'monitor') {
    return {
      moduleId: 'mysql',
      title: featureLabel('monitor'),
      tooltip: buildConnectionTabTooltip(
        item.profileName,
        item.hostAddress,
        undefined,
        featureLabel('monitor'),
      ),
      icon: kindIcon('mysql'),
      props: {
        profileId: item.profileId,
        initialTab: 'monitor',
      },
    }
  }

  if (feature === 'tools') {
    const database = segmentName(ctx, 'database')
    const props: Record<string, unknown> = {
      profileId: item.profileId,
      initialTab: 'tools',
    }
    if (database) props.database = database
    const baseTitle = database || item.profileName
    const toolsLabel = featureLabel('tools')
    return {
      moduleId: 'mysql',
      title: `${baseTitle} · ${toolsLabel}`,
      tooltip: buildConnectionTabTooltip(
        item.profileName,
        item.hostAddress,
        database || undefined,
        toolsLabel,
      ),
      icon: kindIcon('mysql'),
      props,
    }
  }

  if (feature === 'design') {
    const database = segmentName(ctx, 'database')
    const table = segmentName(ctx, 'table')
    const designMode = resolveDesignMode(ctx)
    const resource = database && table ? `${database}.${table}` : database || undefined
    const designLabel = featureLabel('design')
    const props: Record<string, unknown> = {
      profileId: item.profileId,
      initialTab: 'design',
      designMode,
    }
    if (database) props.database = database
    if (table) props.table = table
    return {
      moduleId: 'mysql',
      title: table || designLabel,
      tooltip: buildConnectionTabTooltip(
        item.profileName,
        item.hostAddress,
        resource,
        designLabel,
      ),
      icon: kindIcon('mysql'),
      props,
    }
  }

  const database = segmentName(ctx, 'database')
  const table = segmentName(ctx, 'table')
  const routine = segmentName(ctx, 'routine')
  const routineKind = resolveRoutineKind(ctx)
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: feature,
  }
  if (database) props.database = database
  if (table) props.table = table
  if (routine) props.routine = routine
  if (routineKind) props.routineKind = routineKind
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }
  if (ctx?.autoRunInitialSql) {
    props.autoRunInitialSql = true
  }

  const objectName = table ?? routine
  let resource: string | undefined
  if (database && objectName) {
    resource = `${database}.${objectName}`
  } else if (database) {
    resource = database
  }
  const paneLabel = featureLabel(feature, routineKind)
  // 表/视图/例程：Tab 只显示对象名；无对象时回退库名或连接名
  const title = objectName || database || item.profileName

  return {
    moduleId: 'mysql',
    title,
    tooltip: buildConnectionTabTooltip(
      item.profileName,
      item.hostAddress,
      resource,
      paneLabel,
    ),
    icon: kindIcon('mysql'),
    props,
  }
}

/**
 * MySQL：查询可多开；browse/ddl/objectScript/monitor/tools/debug 按 profile+资源+feature 去重。
 */
export const mysqlConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'mysql',
  dedupFocus: true,

  buildTabSpec: buildMysqlTabSpec,

  findExistingTab(tabs, _spec, item, ctx) {
    const feature = resolveFeature(ctx)
    if (feature === 'query') return undefined

    const database = segmentName(ctx, 'database')
    const table = segmentName(ctx, 'table')
    const objectKind = resolveObjectKind(ctx)
    const objectName = resolveObjectName(ctx, objectKind)
    const designMode = resolveDesignMode(ctx)

    return tabs.find((tab: WorkspaceTab) => {
      if (tab.moduleId !== 'mysql' || tab.props.profileId !== item.profileId) {
        return false
      }
      const tabFeature = normalizeMysqlFeature(
        typeof tab.props.initialTab === 'string' ? tab.props.initialTab : undefined,
      )
      if (tabFeature !== feature) return false
      if (feature === 'monitor') return true
      if (feature === 'tools') {
        const tabDb = typeof tab.props.database === 'string' ? tab.props.database : undefined
        return tabDb === database
      }
      if (feature === 'design') {
        const tabDb = typeof tab.props.database === 'string' ? tab.props.database : undefined
        const tabTable = typeof tab.props.table === 'string' ? tab.props.table : undefined
        const tabDesignMode = typeof tab.props.designMode === 'string' ? tab.props.designMode : 'alter'
        return tabDb === database && tabTable === table && tabDesignMode === designMode
      }
      if (feature === 'objectScript') {
        const tabDb = typeof tab.props.database === 'string' ? tab.props.database : undefined
        const tabKind =
          typeof tab.props.objectKind === 'string'
            ? tab.props.objectKind
            : typeof tab.props.routineKind === 'string'
              ? tab.props.routineKind
              : 'view'
        const tabName =
          typeof tab.props.objectName === 'string'
            ? tab.props.objectName
            : typeof tab.props.routine === 'string'
              ? tab.props.routine
              : typeof tab.props.table === 'string'
                ? tab.props.table
                : undefined
        const tabDesignMode =
          typeof tab.props.designMode === 'string' ? tab.props.designMode : 'alter'
        return (
          tabDb === database &&
          tabKind === objectKind &&
          tabName === objectName &&
          tabDesignMode === designMode
        )
      }
      const tabDb = typeof tab.props.database === 'string' ? tab.props.database : undefined
      const tabTable = typeof tab.props.table === 'string' ? tab.props.table : undefined
      return tabDb === database && tabTable === table
    })
  },
}
