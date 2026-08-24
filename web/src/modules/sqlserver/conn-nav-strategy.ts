import type { ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import { buildConnectionTabTooltip, nextQueryTabIndex } from '@/modules/ops/connection-nav/utils'
import type { ConnectionNavStrategy, ConnectionNavTabSpec } from '@/modules/ops/connection-nav/types'
import type { WorkspaceTab } from '@/stores/tab'
import { useTabStore } from '@/stores/tab'
import { kindIcon } from '@/modules/ops/types'
import { i18n } from '@/locale'
import {
  normalizeSqlServerFeature,
  sqlserverPaneRegistry,
  type SqlServerSessionTab,
} from '@/modules/sqlserver/pane-registry'
import {
  isCreatePlaceholderName,
  isObjectCategory,
  objectKindIcon,
  type SqlServerObjectKind,
  type SqlServerObjectScriptMode,
} from '@/modules/sqlserver/types/object-script'

function segmentName(ctx: ConnOpenContext | undefined, kind: string): string | undefined {
  return ctx?.resourcePath?.segments.find((segment) => segment.kind === kind)?.name
}

function featureLabel(tab: SqlServerSessionTab): string {
  return i18n.global.t(sqlserverPaneRegistry[tab].labelKey)
}

function resolveDesignMode(ctx?: ConnOpenContext): SqlServerObjectScriptMode {
  return ctx?.designMode === 'create' ? 'create' : 'alter'
}

function resolveObjectKind(ctx?: ConnOpenContext): SqlServerObjectKind | undefined {
  const kind = ctx?.objectKind
  if (
    kind === 'view' ||
    kind === 'procedure' ||
    kind === 'function' ||
    kind === 'sequence' ||
    kind === 'synonym'
  ) {
    return kind
  }
  const category = segmentName(ctx, 'category')
  if (category === 'views') return 'view'
  if (category === 'procedures') return 'procedure'
  if (category === 'functions') return 'function'
  if (category === 'sequences') return 'sequence'
  if (category === 'synonyms') return 'synonym'
  if (segmentName(ctx, 'function')) return 'function'
  if (segmentName(ctx, 'procedure')) return 'procedure'
  if (segmentName(ctx, 'sequence')) return 'sequence'
  if (segmentName(ctx, 'synonym')) return 'synonym'
  return undefined
}

function resolveObjectName(ctx?: ConnOpenContext, objectKind?: SqlServerObjectKind): string | undefined {
  if (objectKind === 'view') return segmentName(ctx, 'table')
  if (objectKind === 'procedure') return segmentName(ctx, 'procedure')
  if (objectKind === 'function') return segmentName(ctx, 'function')
  if (objectKind === 'sequence') return segmentName(ctx, 'sequence')
  if (objectKind === 'synonym') return segmentName(ctx, 'synonym')
  return (
    segmentName(ctx, 'table') ??
    segmentName(ctx, 'function') ??
    segmentName(ctx, 'procedure') ??
    segmentName(ctx, 'sequence') ??
    segmentName(ctx, 'synonym')
  )
}

function objectScriptFeatureLabel(objectKind: SqlServerObjectKind | undefined, designMode: SqlServerObjectScriptMode): string {
  if (designMode === 'create') {
    if (objectKind === 'procedure') return i18n.global.t('modules.sqlserver.session.tabNewProcedure')
    if (objectKind === 'function') return i18n.global.t('modules.sqlserver.session.tabNewFunction')
    if (objectKind === 'sequence') return i18n.global.t('modules.sqlserver.session.tabNewSequence')
    if (objectKind === 'synonym') return i18n.global.t('modules.sqlserver.session.tabNewSynonym')
    return i18n.global.t('modules.sqlserver.session.tabNewView')
  }
  if (objectKind === 'procedure') return i18n.global.t('modules.sqlserver.session.tabProcedure')
  if (objectKind === 'function') return i18n.global.t('modules.sqlserver.session.tabFunction')
  if (objectKind === 'sequence') return i18n.global.t('modules.sqlserver.session.tabSequence')
  if (objectKind === 'synonym') return i18n.global.t('modules.sqlserver.session.tabSynonym')
  return i18n.global.t('modules.sqlserver.session.tabView')
}

function resolveFeature(ctx?: ConnOpenContext): SqlServerSessionTab {
  if (ctx?.initialTab) return normalizeSqlServerFeature(ctx.initialTab)
  if (segmentName(ctx, 'function') || segmentName(ctx, 'procedure') || segmentName(ctx, 'sequence')) {
    return 'objectScript'
  }
  if (segmentName(ctx, 'table')) {
    const category = segmentName(ctx, 'category')
    if (isObjectCategory(category) && category === 'views' && ctx?.designMode) {
      return 'objectScript'
    }
    return 'browse'
  }
  return 'query'
}

function relationName(ctx?: ConnOpenContext): string | undefined {
  return segmentName(ctx, 'table') || segmentName(ctx, 'synonym')
}

function isViewPath(ctx?: ConnOpenContext): boolean {
  return segmentName(ctx, 'category') === 'views' || Boolean(segmentName(ctx, 'synonym'))
}

function tabString(tab: WorkspaceTab, key: string): string {
  const value = tab.props[key]
  return typeof value === 'string' ? value : ''
}

function buildQueryTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || item.connectionOptions?.database
  const host = item.hostAddress || item.profileName
  const queryIndex = nextQueryTabIndex(useTabStore().allTabs, 'sqlserver', item.profileId, () => true)
  const queryTitle = i18n.global.t('modules.sqlserver.session.tabQueryIndexed', { n: queryIndex })

  const props: Record<string, unknown> = { profileId: item.profileId, initialTab: 'query' }
  if (typeof database === 'string' && database.trim()) props.database = database.trim()
  if (ctx?.initialSql?.trim()) props.initialSql = ctx.initialSql
  if (ctx?.autoRunInitialSql) props.autoRunInitialSql = true

  return {
    moduleId: 'sqlserver',
    title: `${(typeof database === 'string' && database.trim()) || host} · ${queryTitle}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, undefined, queryTitle),
    icon: kindIcon('sqlserver'),
    props,
  }
}

function buildRelationTabSpec(
  item: ConnItem,
  ctx: ConnOpenContext | undefined,
  feature: 'browse' | 'ddl',
): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || ''
  const schema = segmentName(ctx, 'schema') || ''
  const table = relationName(ctx) || ''
  const isView = isViewPath(ctx)
  const label = featureLabel(feature)
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: feature,
    isView,
  }
  if (database) props.database = database
  if (schema) props.schema = schema
  if (table) props.table = table

  const title = table || [database, schema].filter(Boolean).join('.') || item.profileName
  const resource = [database, schema, table].filter(Boolean).join('.') || undefined
  return {
    moduleId: 'sqlserver',
    title,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, resource, label),
    icon: sqlserverPaneRegistry[feature].icon,
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
  if (objectKind === 'view' && objectName) {
    props.table = objectName
    props.isView = true
  }
  if ((objectKind === 'procedure' || objectKind === 'function') && objectName) {
    props.routine = objectName
  }
  if (objectKind === 'sequence' && objectName) {
    props.sequence = objectName
  }
  if (objectKind === 'synonym' && objectName) {
    props.synonym = objectName
    props.table = objectName
    props.isView = true
  }
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }

  const title =
    designMode === 'create' && isCreatePlaceholderName(objectName) ? featureTitle : objectName || featureTitle
  const resource =
    designMode === 'create' && isCreatePlaceholderName(objectName)
      ? [database, schema].filter(Boolean).join('.') || undefined
      : [database, schema, objectName].filter(Boolean).join('.') || undefined

  return {
    moduleId: 'sqlserver',
    title,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, resource, featureTitle),
    icon: objectKindIcon(objectKind),
    props,
  }
}

function resolveCallKind(ctx?: ConnOpenContext): 'procedure' | 'function' {
  const kind = resolveObjectKind(ctx)
  if (kind === 'function' || segmentName(ctx, 'function')) return 'function'
  return 'procedure'
}

function buildCallTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || ''
  const schema = segmentName(ctx, 'schema') || ''
  const routineKind = resolveCallKind(ctx)
  const routine = resolveObjectName(ctx, routineKind) || ''
  const label = featureLabel('call')
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'call',
    objectKind: routineKind,
    routineKind,
  }
  if (database) props.database = database
  if (schema) props.schema = schema
  if (routine) {
    props.routine = routine
    props.objectName = routine
  }
  const title = routine || [database, schema].filter(Boolean).join('.') || item.profileName
  const resource = [database, schema, routine].filter(Boolean).join('.') || undefined
  return {
    moduleId: 'sqlserver',
    title,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, resource, label),
    icon: sqlserverPaneRegistry.call.icon,
    props,
  }
}

export const sqlserverConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'sqlserver',
  dedupFocus: true,
  buildTabSpec(item, ctx) {
    const feature = resolveFeature(ctx)
    if (feature === 'objectScript') return buildObjectScriptTabSpec(item, ctx)
    if (feature === 'design') {
      const database = segmentName(ctx, 'database') || ''
      const schema = segmentName(ctx, 'schema') || ''
      const table = relationName(ctx) || ''
      const designMode = resolveDesignMode(ctx)
      const label = featureLabel('design')
      const props: Record<string, unknown> = {
        profileId: item.profileId,
        initialTab: 'design',
        designMode,
      }
      if (database) props.database = database
      if (schema) props.schema = schema
      if (table) props.table = table
      const title = table || [database, schema].filter(Boolean).join('.') || item.profileName
      return {
        moduleId: 'sqlserver',
        title: `${title} · ${label}`,
        tooltip: buildConnectionTabTooltip(
          item.profileName,
          item.hostAddress,
          [database, schema, table].filter(Boolean).join('.') || undefined,
          label,
        ),
        icon: sqlserverPaneRegistry.design.icon,
        props,
      }
    }
    if (feature === 'monitor') {
      const label = featureLabel('monitor')
      return {
        moduleId: 'sqlserver',
        title: label,
        tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, undefined, label),
        icon: sqlserverPaneRegistry.monitor.icon,
        props: {
          profileId: item.profileId,
          initialTab: 'monitor',
        },
      }
    }
    if (feature === 'browse' || feature === 'ddl') return buildRelationTabSpec(item, ctx, feature)
    if (feature === 'call') return buildCallTabSpec(item, ctx)
    return buildQueryTabSpec(item, ctx)
  },
  findExistingTab(tabs, _spec, item, ctx) {
    const feature = resolveFeature(ctx)
    if (feature === 'query') return undefined
    if (feature === 'objectScript' && resolveDesignMode(ctx) === 'create') return undefined
    if (feature === 'design' && resolveDesignMode(ctx) === 'create') return undefined
    if (feature === 'monitor') {
      return tabs.find(
        (tab: WorkspaceTab) =>
          tab.moduleId === 'sqlserver' &&
          tab.props.profileId === item.profileId &&
          normalizeSqlServerFeature(tabString(tab, 'initialTab')) === 'monitor',
      )
    }

    const database = segmentName(ctx, 'database') || ''
    const schema = segmentName(ctx, 'schema') || ''
    const table = relationName(ctx) || ''
    const objectKind = resolveObjectKind(ctx)
    const objectName = resolveObjectName(ctx, objectKind)
    const designMode = resolveDesignMode(ctx)

    return tabs.find((tab: WorkspaceTab) => {
      if (tab.moduleId !== 'sqlserver') return false
      if (tab.props.profileId !== item.profileId) return false
      if (normalizeSqlServerFeature(tabString(tab, 'initialTab')) !== feature) return false
      if (tabString(tab, 'database') !== database || tabString(tab, 'schema') !== schema) return false

      if (feature === 'design') {
        const tabMode = tab.props.designMode === 'create' ? 'create' : 'alter'
        return tabString(tab, 'table') === table && tabMode === designMode
      }

      if (feature === 'objectScript') {
        const tabKind = tabString(tab, 'objectKind') || tabString(tab, 'routineKind') || 'view'
        const tabName =
          tabString(tab, 'objectName') ||
          tabString(tab, 'routine') ||
          tabString(tab, 'sequence') ||
          tabString(tab, 'synonym') ||
          tabString(tab, 'table')
        const tabDesign = tabString(tab, 'designMode') || 'alter'
        return tabKind === objectKind && tabName === objectName && tabDesign === designMode
      }

      if (feature === 'call') {
        const routineKind = objectKind === 'function' ? 'function' : 'procedure'
        const routine = objectName || ''
        const tabRoutine = tabString(tab, 'routine') || tabString(tab, 'objectName')
        const tabKind =
          tabString(tab, 'routineKind') === 'function' || tabString(tab, 'objectKind') === 'function'
            ? 'function'
            : 'procedure'
        return tabRoutine === routine && tabKind === routineKind
      }

      return tabString(tab, 'table') === table
    })
  },
}
