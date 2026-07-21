import type { ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import { buildConnectionTabTooltip } from '@/modules/ops/connection-nav/utils'
import type { ConnectionNavStrategy, ConnectionNavTabSpec } from '@/modules/ops/connection-nav/types'
import type { WorkspaceTab } from '@/stores/tab'
import { kindIcon } from '@/modules/ops/types'
import { i18n } from '@/locale'
import {
  normalizeVastFeature,
  vastPaneRegistry,
  type VastSessionTab,
} from '@/modules/vastbase/pane-registry'

function segmentName(ctx: ConnOpenContext | undefined, kind: string): string | undefined {
  const seg = ctx?.resourcePath?.segments.find((s) => s.kind === kind)
  return seg?.name
}

function featureLabel(tab: VastSessionTab, routineKind?: 'function' | 'procedure'): string {
  if (tab === 'source') {
    return i18n.global.t(
      routineKind === 'procedure'
        ? 'modules.vastbase.session.tabProcedure'
        : 'modules.vastbase.session.tabFunction',
    )
  }
  return i18n.global.t(vastPaneRegistry[tab].labelKey)
}

function resolveFeature(ctx?: ConnOpenContext): VastSessionTab {
  if (ctx?.initialTab) {
    return normalizeVastFeature(ctx.initialTab)
  }
  const table = segmentName(ctx, 'table')
  const routine = segmentName(ctx, 'function') ?? segmentName(ctx, 'procedure')
  if (table) return 'browse'
  if (routine) return 'source'
  if (segmentName(ctx, 'schema') && !segmentName(ctx, 'category')) return 'overview'
  if (segmentName(ctx, 'database') && !segmentName(ctx, 'schema')) return 'overview'
  return 'query'
}

/**
 * 查询 Tab：连接/库入口只绑库；Schema 入口可绑 schema，便于同库多 SQL 编辑器并存。
 */
function buildQueryTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const fromPath = segmentName(ctx, 'database')
  const fromProfile = item.connectionOptions?.database
  const database =
    fromPath ||
    (typeof fromProfile === 'string' && fromProfile.trim() ? fromProfile.trim() : undefined)
  const schema = segmentName(ctx, 'schema')

  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'query',
  }
  if (database) props.database = database
  if (schema) props.schema = schema
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }
  if (ctx?.autoRunInitialSql) {
    props.autoRunInitialSql = true
  }

  let baseTitle = item.profileName
  if (database && schema) {
    baseTitle = `${database}.${schema}`
  } else if (database) {
    baseTitle = database
  }
  return {
    moduleId: 'vastbase',
    title: `${baseTitle} · ${featureLabel('query')}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress),
    icon: kindIcon('vastbase'),
    props,
  }
}

function buildVastTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const feature = resolveFeature(ctx)
  if (feature === 'query') {
    return buildQueryTabSpec(item, ctx)
  }

  const database = segmentName(ctx, 'database')
  const schema = segmentName(ctx, 'schema')
  const table = segmentName(ctx, 'table')
  const functionName = segmentName(ctx, 'function')
  const procedureName = segmentName(ctx, 'procedure')
  const routine = functionName ?? procedureName
  const routineKind = procedureName ? 'procedure' : functionName ? 'function' : undefined
  const args = segmentName(ctx, 'args')
  const oidRaw = segmentName(ctx, 'oid')
  const oid = oidRaw && Number.isFinite(Number(oidRaw)) ? Number(oidRaw) : undefined

  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: feature,
  }
  if (database) props.database = database
  if (schema) props.schema = schema
  if (table) props.table = table
  if (routine) props.routine = routine
  if (routineKind) props.routineKind = routineKind
  if (args) props.args = args
  if (oid != null && oid > 0) props.oid = oid
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }
  if (ctx?.autoRunInitialSql) {
    props.autoRunInitialSql = true
  }
  if (ctx?.designMode === 'create' || ctx?.designMode === 'alter') {
    props.designMode = ctx.designMode
  }

  let baseTitle = item.profileName
  if (feature === 'design' && ctx?.designMode === 'create' && database && schema) {
    baseTitle = `${database}.${schema}`
  } else if (database && schema && (table || routine)) {
    const leaf =
      routine && args ? `${routine}(${args})` : (table ?? routine)
    baseTitle = `${database}.${schema}.${leaf}`
  } else if (database && schema) {
    baseTitle = `${database}.${schema}`
  } else if (database) {
    baseTitle = database
  }

  const suffix =
    feature === 'design' && ctx?.designMode === 'create'
      ? i18n.global.t('modules.vastbase.session.tabDesignCreate')
      : featureLabel(feature, routineKind)
  const title = suffix ? `${baseTitle} · ${suffix}` : baseTitle

  return {
    moduleId: 'vastbase',
    title,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress),
    icon: kindIcon('vastbase'),
    props,
  }
}

/**
 * Vastbase：同 profile + 资源路径 + 功能面板 去重聚焦；
 * 查询 Tab 始终新建（由调用方 forceNew / findExistingTab 跳过保证多编辑器）。
 * 物理连接按 session-policy 在同站点共享（per_profile）。
 */
export const vastbaseConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'vastbase',
  dedupFocus: true,

  buildTabSpec: buildVastTabSpec,

  findExistingTab(tabs, _spec, item, ctx) {
    const feature = resolveFeature(ctx)
    // 查询可多开：不去重聚焦；新建表设计始终新 Tab
    if (feature === 'query') return undefined
    if (feature === 'design' && ctx?.designMode === 'create') return undefined

    const database = segmentName(ctx, 'database')
    const schema = segmentName(ctx, 'schema')
    const table = segmentName(ctx, 'table')
    const routine = segmentName(ctx, 'function') ?? segmentName(ctx, 'procedure')
    const args = segmentName(ctx, 'args')
    const oidRaw = segmentName(ctx, 'oid')
    const oid = oidRaw && Number.isFinite(Number(oidRaw)) ? Number(oidRaw) : undefined
    const category = segmentName(ctx, 'category')
    return tabs.find((tab: WorkspaceTab) => {
      if (tab.moduleId !== 'vastbase' || tab.props.profileId !== item.profileId) {
        return false
      }
      const tabDb = typeof tab.props.database === 'string' ? tab.props.database : undefined
      const tabSchema = typeof tab.props.schema === 'string' ? tab.props.schema : undefined
      const tabTable = typeof tab.props.table === 'string' ? tab.props.table : undefined
      const tabRoutine = typeof tab.props.routine === 'string' ? tab.props.routine : undefined
      const tabArgs = typeof tab.props.args === 'string' ? tab.props.args : undefined
      const tabOid = typeof tab.props.oid === 'number' ? tab.props.oid : undefined
      const tabFeature = normalizeVastFeature(
        typeof tab.props.initialTab === 'string' ? tab.props.initialTab : undefined,
      )
      const tabDesignMode =
        typeof tab.props.designMode === 'string' ? tab.props.designMode : undefined
      if (tabDesignMode === 'create') return false
      return (
        tabDb === database &&
        tabSchema === schema &&
        tabTable === table &&
        tabRoutine === routine &&
        tabArgs === args &&
        tabOid === oid &&
        tabFeature === feature &&
        (feature !== 'overview' || !category)
      )
    })
  },
}
