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
  normalizeOracleFeature,
  oraclePaneRegistry,
  type OracleSessionTab,
} from '@/modules/oracle/pane-registry'
import {
  categoryToObjectKind,
  isObjectCategory,
  objectKindIcon,
  type OracleObjectKind,
  type OracleObjectScriptMode,
} from '@/modules/oracle/types/object-script'

function segmentName(ctx: ConnOpenContext | undefined, kind: string): string | undefined {
  return ctx?.resourcePath?.segments.find((s) => s.kind === kind)?.name
}

function featureLabel(tab: OracleSessionTab): string {
  return i18n.global.t(oraclePaneRegistry[tab].labelKey)
}

function resolveDesignMode(ctx?: ConnOpenContext): OracleObjectScriptMode {
  return ctx?.designMode === 'create' ? 'create' : 'alter'
}

function resolveObjectKind(ctx?: ConnOpenContext): OracleObjectKind | undefined {
  if (
    ctx?.objectKind === 'view' ||
    ctx?.objectKind === 'procedure' ||
    ctx?.objectKind === 'function' ||
    ctx?.objectKind === 'package'
  ) {
    return ctx.objectKind
  }
  const category = segmentName(ctx, 'category')
  if (isObjectCategory(category)) return categoryToObjectKind(category)
  if (segmentName(ctx, 'routine')) return 'procedure'
  if (segmentName(ctx, 'package')) return 'package'
  return undefined
}

function resolveObjectName(ctx?: ConnOpenContext, objectKind?: OracleObjectKind): string | undefined {
  if (objectKind === 'procedure' || objectKind === 'function') {
    return segmentName(ctx, 'routine') ?? segmentName(ctx, 'table')
  }
  if (objectKind === 'package') {
    return segmentName(ctx, 'package') ?? segmentName(ctx, 'routine')
  }
  return segmentName(ctx, 'table') ?? segmentName(ctx, 'routine')
}

function objectScriptFeatureLabel(
  objectKind: OracleObjectKind,
  designMode: OracleObjectScriptMode,
): string {
  if (designMode === 'create') {
    if (objectKind === 'procedure') return i18n.global.t('modules.oracle.session.tabNewProcedure')
    if (objectKind === 'function') return i18n.global.t('modules.oracle.session.tabNewFunction')
    if (objectKind === 'package') return i18n.global.t('modules.oracle.session.tabNewPackage')
    return i18n.global.t('modules.oracle.session.tabNewView')
  }
  if (objectKind === 'procedure') return i18n.global.t('modules.oracle.session.tabProcedure')
  if (objectKind === 'function') return i18n.global.t('modules.oracle.session.tabFunction')
  if (objectKind === 'package') return i18n.global.t('modules.oracle.session.tabPackage')
  return i18n.global.t('modules.oracle.session.tabView')
}

function resolveFeature(ctx?: ConnOpenContext): OracleSessionTab {
  if (ctx?.initialTab) {
    return normalizeOracleFeature(ctx.initialTab)
  }
  if (segmentName(ctx, 'routine') || segmentName(ctx, 'package')) return 'objectScript'
  const category = segmentName(ctx, 'category')
  if (category === 'views' && segmentName(ctx, 'table') && ctx?.designMode) {
    return 'objectScript'
  }
  if (segmentName(ctx, 'sequence') || category === 'sequences') return 'query'
  if (segmentName(ctx, 'table')) return 'browse'
  return 'query'
}

function buildQueryTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const schema = segmentName(ctx, 'schema')
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'query',
  }
  if (schema) props.schema = schema
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }
  if (ctx?.autoRunInitialSql) {
    props.autoRunInitialSql = true
  }

  const queryIndex = nextQueryTabIndex(
    useTabStore().allTabs,
    'oracle',
    item.profileId,
    (initialTab) =>
      normalizeOracleFeature(typeof initialTab === 'string' ? initialTab : undefined) === 'query',
  )
  const queryTitle = i18n.global.t('modules.oracle.session.tabQueryIndexed', { n: queryIndex })
  const baseTitle = schema || item.profileName || item.hostAddress

  return {
    moduleId: 'oracle',
    title: `${baseTitle} · ${queryTitle}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, schema, queryTitle),
    icon: kindIcon('oracle'),
    props,
  }
}

function buildObjectScriptTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const schema = segmentName(ctx, 'schema')
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
  if (schema) props.schema = schema
  if (objectName) props.objectName = objectName
  if (objectKind === 'view' && objectName) {
    props.table = objectName
    props.isView = true
  }
  if ((objectKind === 'procedure' || objectKind === 'function') && objectName) {
    props.routine = objectName
    props.routineKind = objectKind
  }
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }

  const resource =
    schema && objectName ? `${schema}.${objectName}` : schema || undefined
  // Tab 只显示对象名；完整 schema.对象放 tip（对齐 MySQL）
  const title = objectName || featureTitle

  return {
    moduleId: 'oracle',
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

function buildOracleTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const feature = resolveFeature(ctx)
  if (feature === 'query') return buildQueryTabSpec(item, ctx)
  if (feature === 'objectScript') return buildObjectScriptTabSpec(item, ctx)

  if (feature === 'monitor') {
    const monitorLabel = featureLabel('monitor')
    return {
      moduleId: 'oracle',
      title: monitorLabel,
      tooltip: buildConnectionTabTooltip(
        item.profileName,
        item.hostAddress,
        undefined,
        monitorLabel,
      ),
      icon: kindIcon('oracle'),
      props: {
        profileId: item.profileId,
        initialTab: 'monitor',
      },
    }
  }

  if (feature === 'design') {
    const schema = segmentName(ctx, 'schema')
    const table = segmentName(ctx, 'table')
    const designMode = resolveDesignMode(ctx)
    const resource = schema && table ? `${schema}.${table}` : schema || undefined
    const designLabel = featureLabel('design')
    const props: Record<string, unknown> = {
      profileId: item.profileId,
      initialTab: 'design',
      designMode,
    }
    if (schema) props.schema = schema
    if (table) props.table = table
    return {
      moduleId: 'oracle',
      title: table || designLabel,
      tooltip: buildConnectionTabTooltip(
        item.profileName,
        item.hostAddress,
        resource,
        designLabel,
      ),
      icon: kindIcon('oracle'),
      props,
    }
  }

  const schema = segmentName(ctx, 'schema')
  const table = segmentName(ctx, 'table')
  const category = segmentName(ctx, 'category')
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: feature,
  }
  if (schema) props.schema = schema
  if (table) props.table = table
  if (category === 'views') props.isView = true
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }

  const resource = schema && table ? `${schema}.${table}` : schema || undefined
  const paneLabel = featureLabel(feature)
  // 表/视图：Tab 只显示对象名；无对象时回退 schema 或连接名
  const title = table || schema || item.profileName

  return {
    moduleId: 'oracle',
    title,
    tooltip: buildConnectionTabTooltip(
      item.profileName,
      item.hostAddress,
      resource,
      paneLabel,
    ),
    icon: kindIcon('oracle'),
    props,
  }
}

/**
 * Oracle：query 可多开；browse/ddl/objectScript/monitor/design 按 profile+资源+feature 去重。
 * Tab 标题对齐 MySQL：对象短标题，完整路径放 tooltip。
 */
export const oracleConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'oracle',
  dedupFocus: true,

  buildTabSpec: buildOracleTabSpec,

  findExistingTab(tabs, _spec, item, ctx) {
    const feature = resolveFeature(ctx)
    if (feature === 'query') return undefined

    const schema = segmentName(ctx, 'schema')

    return tabs.find((tab: WorkspaceTab) => {
      if (tab.moduleId !== 'oracle' || tab.props.profileId !== item.profileId) return false
      const tabFeature = normalizeOracleFeature(
        typeof tab.props.initialTab === 'string' ? tab.props.initialTab : undefined,
      )
      if (tabFeature !== feature) return false
      if (feature === 'monitor') return true

      const tabSchema = typeof tab.props.schema === 'string' ? tab.props.schema : undefined
      if (tabSchema !== schema) return false

      if (feature === 'design') {
        const table = segmentName(ctx, 'table')
        const designMode = resolveDesignMode(ctx)
        const tabTable = typeof tab.props.table === 'string' ? tab.props.table : undefined
        const tabMode = tab.props.designMode === 'create' ? 'create' : 'alter'
        return tabTable === table && tabMode === designMode
      }

      if (feature === 'objectScript') {
        const objectKind = resolveObjectKind(ctx) ?? 'view'
        const objectName = resolveObjectName(ctx, objectKind)
        const designMode = resolveDesignMode(ctx)
        const tabKind = tab.props.objectKind
        const tabName =
          (typeof tab.props.objectName === 'string' && tab.props.objectName)
          || (typeof tab.props.routine === 'string' && tab.props.routine)
          || (typeof tab.props.table === 'string' && tab.props.table)
          || undefined
        const tabMode = tab.props.designMode === 'create' ? 'create' : 'alter'
        return tabKind === objectKind && tabName === objectName && tabMode === designMode
      }

      const table = segmentName(ctx, 'table')
      const tabTable = typeof tab.props.table === 'string' ? tab.props.table : undefined
      return tabTable === table
    })
  },
}
