import type { ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import { buildConnectionTabTooltip, nextQueryTabIndex } from '@/modules/ops/connection-nav/utils'
import type { ConnectionNavStrategy, ConnectionNavTabSpec } from '@/modules/ops/connection-nav/types'
import type { WorkspaceTab } from '@/stores/tab'
import { useTabStore } from '@/stores/tab'
import { kindIcon } from '@/modules/ops/types'
import { i18n } from '@/locale'
import {
  postgresPaneRegistry,
  normalizePostgresFeature,
  type PostgresSessionTab,
} from '@/modules/postgres/pane-registry'
import {
  isCreatePlaceholderName,
  isObjectCategory,
  objectKindIcon,
  type PostgresObjectKind,
  type PostgresObjectScriptMode,
} from '@/modules/postgres/types/object-script'

function segmentName(ctx: ConnOpenContext | undefined, kind: string): string | undefined {
  return ctx?.resourcePath?.segments.find((segment) => segment.kind === kind)?.name
}

function featureLabel(tab: PostgresSessionTab): string {
  return i18n.global.t(postgresPaneRegistry[tab].labelKey)
}

function resolveDesignMode(ctx?: ConnOpenContext): PostgresObjectScriptMode {
  return ctx?.designMode === 'create' ? 'create' : 'alter'
}

function resolveObjectKind(ctx?: ConnOpenContext): PostgresObjectKind | undefined {
  const kind = ctx?.objectKind
  if (kind === 'materializedView' || kind === 'materialized_view') return 'materialized_view'
  if (
    kind === 'view' ||
    kind === 'procedure' ||
    kind === 'function' ||
    kind === 'sequence' ||
    kind === 'trigger'
  ) {
    return kind
  }
  const category = segmentName(ctx, 'category')
  if (category === 'views') return 'view'
  if (category === 'materialized_views') return 'materialized_view'
  if (category === 'triggers') return 'trigger'
  if (category === 'procedures') return 'procedure'
  if (category === 'functions') return 'function'
  if (category === 'sequences') return 'sequence'
  if (segmentName(ctx, 'trigger')) return 'trigger'
  if (segmentName(ctx, 'function')) return 'function'
  if (segmentName(ctx, 'procedure')) return 'procedure'
  if (segmentName(ctx, 'sequence')) return 'sequence'
  return undefined
}

function resolveObjectName(ctx?: ConnOpenContext, objectKind?: PostgresObjectKind): string | undefined {
  if (objectKind === 'view' || objectKind === 'materialized_view') return segmentName(ctx, 'table')
  if (objectKind === 'procedure') return segmentName(ctx, 'procedure')
  if (objectKind === 'function') return segmentName(ctx, 'function')
  if (objectKind === 'sequence') return segmentName(ctx, 'sequence')
  if (objectKind === 'trigger') return segmentName(ctx, 'trigger')
  return (
    segmentName(ctx, 'trigger') ??
    segmentName(ctx, 'table') ??
    segmentName(ctx, 'function') ??
    segmentName(ctx, 'procedure') ??
    segmentName(ctx, 'sequence')
  )
}

function objectScriptFeatureLabel(
  objectKind: PostgresObjectKind | undefined,
  designMode: PostgresObjectScriptMode,
): string {
  if (designMode === 'create') {
    if (objectKind === 'procedure') {
      return i18n.global.t('modules.postgres.session.tabNewProcedure')
    }
    if (objectKind === 'function') {
      return i18n.global.t('modules.postgres.session.tabNewFunction')
    }
    if (objectKind === 'sequence') {
      return i18n.global.t('modules.postgres.session.tabNewSequence')
    }
    if (objectKind === 'materialized_view') {
      return i18n.global.t('modules.postgres.session.tabNewMatView')
    }
    if (objectKind === 'trigger') {
      return i18n.global.t('modules.postgres.session.tabNewTrigger')
    }
    return i18n.global.t('modules.postgres.session.tabNewView')
  }
  if (objectKind === 'procedure') {
    return i18n.global.t('modules.postgres.session.tabProcedure')
  }
  if (objectKind === 'function') {
    return i18n.global.t('modules.postgres.session.tabFunction')
  }
  if (objectKind === 'sequence') {
    return i18n.global.t('modules.postgres.session.tabSequence')
  }
  if (objectKind === 'materialized_view') {
    return i18n.global.t('modules.postgres.session.tabMatView')
  }
  if (objectKind === 'trigger') {
    return i18n.global.t('modules.postgres.session.tabTrigger')
  }
  return i18n.global.t('modules.postgres.session.tabView')
}

function resolveFeature(ctx?: ConnOpenContext): PostgresSessionTab {
  if (ctx?.initialTab) return normalizePostgresFeature(ctx.initialTab)
  if (segmentName(ctx, 'function') || segmentName(ctx, 'procedure')) return 'objectScript'
  if (segmentName(ctx, 'sequence')) return 'objectScript'
  if (segmentName(ctx, 'table')) {
    const category = segmentName(ctx, 'category')
    if (isObjectCategory(category) && category === 'views' && ctx?.designMode) {
      return 'objectScript'
    }
    return 'browse'
  }
  return 'query'
}

function resolveCallKind(ctx?: ConnOpenContext): 'function' | 'procedure' | undefined {
  if (segmentName(ctx, 'function')) return 'function'
  if (segmentName(ctx, 'procedure')) return 'procedure'
  const kind = ctx?.objectKind
  if (kind === 'function' || kind === 'procedure') return kind
  return undefined
}

function buildCallTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || ''
  const schema = segmentName(ctx, 'schema') || ''
  const routine =
    segmentName(ctx, 'function') || segmentName(ctx, 'procedure') || ''
  const routineKind = resolveCallKind(ctx)
  const label = featureLabel('call')
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'call',
    database,
    schema,
    routine,
    routineKind,
    args: segmentName(ctx, 'args') || '',
    oid: Number(segmentName(ctx, 'oid')) || undefined,
  }
  if (ctx?.objectKind) props.objectKind = ctx.objectKind
  // 对齐 MySQL：Tab 只显示例程名；「执行调用」放 tip
  const title = routine || [database, schema].filter(Boolean).join('.') || item.profileName
  const resource = [database, schema, routine].filter(Boolean).join('.') || undefined
  return {
    moduleId: 'postgres',
    title,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, resource, label),
    icon: postgresPaneRegistry.call.icon,
    props,
  }
}

/** 新建表占位名不进入 Tab 标题（对齐 MySQL：create 无表时用功能名）。 */
function designTableTitle(table: string | undefined, designMode: 'create' | 'alter'): string {
  const name = table?.trim()
  if (designMode === 'create') {
    if (name && name !== 'new_table') return name
    return featureLabel('design')
  }
  return name || featureLabel('design')
}

function buildQueryTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || item.connectionOptions?.database
  // 仅选库未选 schema 时默认 public，保证 LSP 表/列补全有默认命名空间
  const schema = segmentName(ctx, 'schema') || (database ? 'public' : undefined)
  const host = item.hostAddress || item.profileName
  const queryIndex = nextQueryTabIndex(useTabStore().allTabs, 'postgres', item.profileId, () => true)
  const queryTitle = i18n.global.t('modules.postgres.session.tabQueryIndexed', { n: queryIndex })

  const props: Record<string, unknown> = { profileId: item.profileId, initialTab: 'query' }
  if (typeof database === 'string' && database.trim()) props.database = database.trim()
  if (typeof schema === 'string' && schema.trim()) props.schema = schema.trim()
  if (ctx?.initialSql?.trim()) props.initialSql = ctx.initialSql
  if (ctx?.autoRunInitialSql) props.autoRunInitialSql = true
  if (ctx?.queryExecMode === 'paged' || ctx?.queryExecMode === 'batch') {
    props.queryExecMode = ctx.queryExecMode
  }
  if (ctx?.designMode) props.designMode = ctx.designMode

  let baseTitle = host
  if (typeof database === 'string' && database.trim() && typeof schema === 'string' && schema.trim()) {
    baseTitle = `${database.trim()}.${schema.trim()}`
  } else if (typeof database === 'string' && database.trim()) {
    baseTitle = database.trim()
  }

  return {
    moduleId: 'postgres',
    title: `${baseTitle} · ${queryTitle}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, undefined, queryTitle),
    icon: kindIcon('postgres'),
    props,
  }
}

function buildDesignTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || ''
  const schema = segmentName(ctx, 'schema') || ''
  const table = segmentName(ctx, 'table') || ''
  const designMode = resolveDesignMode(ctx)
  const designLabel = featureLabel('design')
  const title = designTableTitle(table || undefined, designMode)
  const resource =
    database && schema && table && table !== 'new_table'
      ? `${database}.${schema}.${table}`
      : database && schema
        ? `${database}.${schema}`
        : database || undefined

  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'design',
    designMode,
  }
  if (database) props.database = database
  if (schema) props.schema = schema
  // create 不写入 new_table 占位，避免标题/去重被占位名污染
  if (table && !(designMode === 'create' && table === 'new_table')) {
    props.table = table
  }

  return {
    moduleId: 'postgres',
    title,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, resource, designLabel),
    icon: postgresPaneRegistry.design.icon,
    props,
  }
}

function buildObjectScriptTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || ''
  const schema = segmentName(ctx, 'schema') || ''
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
  if (schema) props.schema = schema
  if (objectName) props.objectName = objectName
  if ((objectKind === 'view' || objectKind === 'materialized_view') && objectName) {
    props.table = objectName
    props.isView = true
  }
  if (objectKind === 'trigger') {
    const onTable = segmentName(ctx, 'ontable')
    if (onTable) props.table = onTable
  }
  if ((objectKind === 'procedure' || objectKind === 'function') && objectName) {
    props.routine = objectName
    props.routineKind = objectKind
  }
  if (objectKind === 'sequence' && objectName) {
    props.sequence = objectName
  }
  const args = segmentName(ctx, 'args')
  const oid = Number(segmentName(ctx, 'oid')) || undefined
  if (args) props.args = args
  if (oid) props.oid = oid
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }

  // Tab 只显示对象名；完整库.schema.对象放 tip（对齐 MySQL）
  // 新建占位名不进入标题，改用「新建视图」等功能名
  const title =
    designMode === 'create' && isCreatePlaceholderName(objectName)
      ? featureTitle
      : objectName || featureTitle
  const resource =
    designMode === 'create' && isCreatePlaceholderName(objectName)
      ? [database, schema].filter(Boolean).join('.') || undefined
      : [database, schema, objectName].filter(Boolean).join('.') || undefined

  return {
    moduleId: 'postgres',
    title,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, resource, featureTitle),
    icon: objectKindIcon(objectKind),
    props,
  }
}

function buildRelationTabSpec(
  item: ConnItem,
  ctx: ConnOpenContext | undefined,
  feature: PostgresSessionTab,
): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || ''
  const schema = segmentName(ctx, 'schema') || ''
  const table = segmentName(ctx, 'table') || ''
  const routine =
    segmentName(ctx, 'function') || segmentName(ctx, 'procedure') || ''
  const routineKind = segmentName(ctx, 'function')
    ? 'function'
    : segmentName(ctx, 'procedure')
      ? 'procedure'
      : undefined
  const category = segmentName(ctx, 'category')
  const isView = category === 'views'
  const label = featureLabel(feature)
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: feature,
    database,
    schema,
    table,
    routine,
    routineKind,
    args: segmentName(ctx, 'args'),
    oid: Number(segmentName(ctx, 'oid')) || undefined,
    isView,
    designMode: ctx?.designMode,
  }
  // 对齐 MySQL：Tab 只显示对象名；完整限定名放 tip
  const objectName = table || routine
  const title = objectName || [database, schema].filter(Boolean).join('.') || item.profileName
  const resource = [database, schema, objectName].filter(Boolean).join('.') || undefined
  return {
    moduleId: 'postgres',
    title,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, resource, label),
    icon: postgresPaneRegistry[feature].icon,
    props,
  }
}

function buildPostgresTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const feature = resolveFeature(ctx)
  if (feature === 'query') return buildQueryTabSpec(item, ctx)
  if (feature === 'design') return buildDesignTabSpec(item, ctx)
  if (feature === 'objectScript') return buildObjectScriptTabSpec(item, ctx)
  if (feature === 'call') return buildCallTabSpec(item, ctx)
  return buildRelationTabSpec(item, ctx, feature)
}

export const postgresConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'postgres',
  dedupFocus: true,
  buildTabSpec: buildPostgresTabSpec,
  findExistingTab(tabs, _spec, item, ctx) {
    const feature = resolveFeature(ctx)
    if (feature === 'query') return undefined
    // 新建表设计始终新 Tab（对齐 Vastbase / 避免多张「新建」互相抢焦点）
    if (feature === 'design' && resolveDesignMode(ctx) === 'create') return undefined

    const database = segmentName(ctx, 'database') || ''
    const schema = segmentName(ctx, 'schema') || ''
    const designMode = resolveDesignMode(ctx)
    const objectKind = resolveObjectKind(ctx)
    const objectName = resolveObjectName(ctx, objectKind)
    const table = segmentName(ctx, 'table') || ''

    return tabs.find((tab: WorkspaceTab) => {
      if (tab.moduleId !== 'postgres') return false
      if (tab.props.profileId !== item.profileId) return false
      if (normalizePostgresFeature(String(tab.props.initialTab ?? '')) !== feature) return false

      if (String(tab.props.database ?? '') !== database) return false
      if (String(tab.props.schema ?? '') !== schema) return false

      if (feature === 'design') {
        const tabTable = String(tab.props.table ?? '')
        const ctxTable = designMode === 'create' && table === 'new_table' ? '' : table
        return (
          tabTable === ctxTable &&
          String(tab.props.designMode ?? 'alter') === designMode
        )
      }

      if (feature === 'objectScript') {
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
              : typeof tab.props.sequence === 'string'
                ? tab.props.sequence
                : typeof tab.props.table === 'string'
                  ? tab.props.table
                  : undefined
        const tabDesignMode =
          typeof tab.props.designMode === 'string' ? tab.props.designMode : 'alter'
        return (
          tabKind === objectKind &&
          tabName === objectName &&
          tabDesignMode === designMode
        )
      }

      if (feature === 'call') {
        // 同一过程/函数（含重载签名）只开一个调用页；不同对象各自独立
        const routine =
          segmentName(ctx, 'function') || segmentName(ctx, 'procedure') || ''
        const args = segmentName(ctx, 'args') || ''
        const oid = segmentName(ctx, 'oid') || ''
        const routineKind = resolveCallKind(ctx) ?? ''
        return (
          String(tab.props.routine ?? '') === routine &&
          String(tab.props.routineKind ?? '') === routineKind &&
          String(tab.props.args ?? '') === args &&
          String(tab.props.oid ?? '') === oid
        )
      }

      const tabTable = String(tab.props.table ?? '')
      return tabTable === table
    })
  },
}
