/**
 * ClickHouse 会话面板：query / browse / ddl / objectScript / monitor / design / tools。
 */
import type {
  ClickHouseObjectKind,
  ClickHouseObjectScriptMode,
} from '@/modules/clickhouse/types/object-script'

export type ClickHouseSessionTab =
  | 'query'
  | 'browse'
  | 'ddl'
  | 'objectScript'
  | 'monitor'
  | 'design'
  | 'tools'

export interface ClickHousePaneScope {
  database?: string
  table?: string
  isView?: boolean
  designMode?: ClickHouseObjectScriptMode | 'create' | 'alter'
  objectKind?: ClickHouseObjectKind
  objectName?: string
  draftSql?: string
}

export interface ClickHousePaneContext extends ClickHousePaneScope {
  sessionId: string | null
  profileId?: string
  initialSql?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
  tabId?: string
}

export interface ClickHousePaneDescriptor {
  loader: () => Promise<{ default: import('vue').Component }>
  buildProps: (ctx: ClickHousePaneContext) => Record<string, unknown>
}

export interface ClickHouseFeatureDef {
  icon: string
  labelKey: string
  resolvePane: (scope?: ClickHousePaneScope) => ClickHousePaneDescriptor
}

function queryProps(ctx: ClickHousePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    initialSql: ctx.initialSql,
    draftSql: ctx.draftSql,
    tabId: ctx.tabId,
    autoRunInitialSql: ctx.autoRunInitialSql === true,
    sessionLabel: ctx.sessionLabel,
  }
}

function relationProps(ctx: ClickHousePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    table: ctx.table,
    isView: ctx.isView === true,
    sessionLabel: ctx.sessionLabel,
  }
}

function monitorProps(ctx: ClickHousePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    sessionLabel: ctx.sessionLabel,
  }
}

function toolsProps(ctx: ClickHousePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    sessionLabel: ctx.sessionLabel,
  }
}

function designProps(ctx: ClickHousePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database ?? '',
    table: ctx.table,
    designMode: ctx.designMode === 'create' ? 'create' : 'alter',
    sessionLabel: ctx.sessionLabel,
  }
}

function resolveObjectKind(scope: ClickHousePaneScope): ClickHouseObjectKind {
  if (
    scope.objectKind === 'view'
    || scope.objectKind === 'materializedView'
    || scope.objectKind === 'dictionary'
  ) {
    return scope.objectKind
  }
  return 'view'
}

function resolveObjectName(scope: ClickHousePaneScope): string | undefined {
  return scope.objectName || scope.table
}

function objectScriptProps(ctx: ClickHousePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    objectKind: resolveObjectKind(ctx),
    objectName: resolveObjectName(ctx),
    designMode: ctx.designMode === 'create' ? 'create' : 'alter',
    initialSql: ctx.initialSql,
    draftSql: ctx.draftSql,
    tabId: ctx.tabId,
    sessionLabel: ctx.sessionLabel,
  }
}

export const clickhousePaneRegistry: Record<ClickHouseSessionTab, ClickHouseFeatureDef> = {
  query: {
    icon: 'code-2',
    labelKey: 'modules.clickhouse.session.tabQuery',
    resolvePane: () => ({
      loader: () => import('@/modules/clickhouse/components/ClickHouseQueryPane.vue'),
      buildProps: queryProps,
    }),
  },
  browse: {
    icon: 'table',
    labelKey: 'modules.clickhouse.session.tabBrowse',
    resolvePane: () => ({
      loader: () => import('@/modules/clickhouse/components/ClickHouseBrowsePane.vue'),
      buildProps: relationProps,
    }),
  },
  ddl: {
    icon: 'file-code',
    labelKey: 'modules.clickhouse.session.tabDdl',
    resolvePane: () => ({
      loader: () => import('@/modules/clickhouse/components/ClickHouseDdlPane.vue'),
      buildProps: relationProps,
    }),
  },
  objectScript: {
    icon: 'file-pen',
    labelKey: 'modules.clickhouse.session.tabObjectScript',
    resolvePane: () => ({
      loader: () => import('@/modules/clickhouse/components/ClickHouseObjectScriptPane.vue'),
      buildProps: objectScriptProps,
    }),
  },
  monitor: {
    icon: 'activity',
    labelKey: 'modules.clickhouse.session.tabMonitor',
    resolvePane: () => ({
      loader: () => import('@/modules/clickhouse/components/ClickHouseMonitorPane.vue'),
      buildProps: monitorProps,
    }),
  },
  design: {
    icon: 'layout-list',
    labelKey: 'modules.clickhouse.session.tabDesign',
    resolvePane: () => ({
      loader: () => import('@/modules/clickhouse/components/ClickHouseDesignPane.vue'),
      buildProps: designProps,
    }),
  },
  tools: {
    icon: 'archive',
    labelKey: 'modules.clickhouse.session.tabTools',
    resolvePane: () => ({
      loader: () => import('@/modules/clickhouse/components/ClickHouseToolsPane.vue'),
      buildProps: toolsProps,
    }),
  },
}

export function normalizeClickHouseFeature(tab: string | undefined): ClickHouseSessionTab {
  if (
    tab === 'browse'
    || tab === 'ddl'
    || tab === 'query'
    || tab === 'objectScript'
    || tab === 'monitor'
    || tab === 'design'
    || tab === 'tools'
  ) {
    return tab
  }
  return 'query'
}

/** 自带顶栏的面板（Session 不再叠第二行 header）。 */
export function clickhouseFeatureEmbedsChrome(_tab: ClickHouseSessionTab): boolean {
  return true
}
