import type { ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import { buildConnectionTabTooltip } from '@/modules/ops/connection-nav/utils'
import type { ConnectionNavStrategy, ConnectionNavTabSpec } from '@/modules/ops/connection-nav/types'
import type { WorkspaceTab } from '@/stores/tab'
import { kindIcon } from '@/modules/ops/types'
import { i18n } from '@/locale'
import {
  mysqlPaneRegistry,
  normalizeMysqlFeature,
  type MysqlSessionTab,
} from '@/modules/mysql/pane-registry'

function segmentName(ctx: ConnOpenContext | undefined, kind: string): string | undefined {
  const seg = ctx?.resourcePath?.segments.find((s) => s.kind === kind)
  return seg?.name
}

function featureLabel(tab: MysqlSessionTab, routineKind?: 'function' | 'procedure'): string {
  if (tab === 'source') {
    return i18n.global.t(
      routineKind === 'procedure'
        ? 'modules.mysql.session.tabProcedure'
        : 'modules.mysql.session.tabFunction',
    )
  }
  return i18n.global.t(mysqlPaneRegistry[tab].labelKey)
}

function resolveDesignMode(ctx?: ConnOpenContext): 'create' | 'alter' {
  return ctx?.designMode === 'create' ? 'create' : 'alter'
}

function resolveFeature(ctx?: ConnOpenContext): MysqlSessionTab {
  if (ctx?.initialTab) {
    return normalizeMysqlFeature(ctx.initialTab)
  }
  if (segmentName(ctx, 'table')) return 'browse'
  if (segmentName(ctx, 'routine')) return 'source'
  return 'query'
}

function resolveRoutineKind(
  ctx?: ConnOpenContext,
): 'procedure' | 'function' | undefined {
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

  return {
    moduleId: 'mysql',
    title: `${baseTitle} · ${featureLabel('query')}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress),
    icon: kindIcon('mysql'),
    props,
  }
}

function buildMysqlTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const feature = resolveFeature(ctx)
  if (feature === 'query') {
    return buildQueryTabSpec(item, ctx)
  }

  if (feature === 'monitor') {
    return {
      moduleId: 'mysql',
      title: `${item.profileName} · ${featureLabel('monitor')}`,
      tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress),
      icon: kindIcon('mysql'),
      props: {
        profileId: item.profileId,
        initialTab: 'monitor',
      },
    }
  }

  if (feature === 'design') {
    const database = segmentName(ctx, 'database')
    const table = segmentName(ctx, 'table')
    const designMode = resolveDesignMode(ctx)
    const baseTitle = database && table ? `${database}.${table}` : database || item.profileName
    const props: Record<string, unknown> = {
      profileId: item.profileId,
      initialTab: 'design',
      designMode,
    }
    if (database) props.database = database
    if (table) props.table = table
    return {
      moduleId: 'mysql',
      title: `${baseTitle} · ${featureLabel('design')}`,
      tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress),
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

  let baseTitle = item.profileName
  if (database && (table || routine)) {
    baseTitle = `${database}.${table ?? routine}`
  } else if (database) {
    baseTitle = database
  }

  return {
    moduleId: 'mysql',
    title: `${baseTitle} · ${featureLabel(feature, routineKind)}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress),
    icon: kindIcon('mysql'),
    props,
  }
}

/**
 * MySQL：查询可多开；browse/ddl/source/monitor 按 profile+资源+feature 去重。
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
    const routine = segmentName(ctx, 'routine')
    return tabs.find((tab: WorkspaceTab) => {
      if (tab.moduleId !== 'mysql' || tab.props.profileId !== item.profileId) {
        return false
      }
      const tabFeature = normalizeMysqlFeature(
        typeof tab.props.initialTab === 'string' ? tab.props.initialTab : undefined,
      )
      if (tabFeature !== feature) return false
      if (feature === 'monitor') return true
      if (feature === 'design') {
        const tabDb = typeof tab.props.database === 'string' ? tab.props.database : undefined
        const tabTable = typeof tab.props.table === 'string' ? tab.props.table : undefined
        const tabDesignMode = typeof tab.props.designMode === 'string' ? tab.props.designMode : 'alter'
        const designMode = resolveDesignMode(ctx)
        return tabDb === database && tabTable === table && tabDesignMode === designMode
      }
      const tabDb = typeof tab.props.database === 'string' ? tab.props.database : undefined
      const tabTable = typeof tab.props.table === 'string' ? tab.props.table : undefined
      const tabRoutine = typeof tab.props.routine === 'string' ? tab.props.routine : undefined
      if (feature === 'source') {
        return tabDb === database && tabRoutine === routine
      }
      return tabDb === database && tabTable === table
    })
  },
}
