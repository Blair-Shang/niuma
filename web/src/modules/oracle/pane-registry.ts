/**
 * Oracle Session 功能面板：query / browse / ddl / objectScript / monitor / design。
 */
import type { OracleObjectKind, OracleObjectScriptMode } from '@/modules/oracle/types/object-script'

export type OracleSessionTab =
  | 'query'
  | 'browse'
  | 'ddl'
  | 'objectScript'
  | 'monitor'
  | 'design'

export interface OraclePaneScope {
  schema?: string
  table?: string
  isView?: boolean
  designMode?: OracleObjectScriptMode | 'create' | 'alter'
  objectKind?: OracleObjectKind
  objectName?: string
  routine?: string
  routineKind?: OracleObjectKind
  draftSql?: string
}

export interface OraclePaneContext extends OraclePaneScope {
  sessionId: string | null
  profileId?: string
  initialSql?: string
  tabId?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
}

export interface OraclePaneDescriptor {
  loader: () => Promise<{ default: import('vue').Component }>
  buildProps: (ctx: OraclePaneContext) => Record<string, unknown>
}

export interface OracleFeatureDef {
  icon: string
  labelKey: string
  resolvePane: (scope?: OraclePaneScope) => OraclePaneDescriptor
}

function queryProps(ctx: OraclePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema,
    initialSql: ctx.initialSql,
    draftSql: ctx.draftSql,
    tabId: ctx.tabId,
    autoRunInitialSql: ctx.autoRunInitialSql === true,
    sessionLabel: ctx.sessionLabel,
  }
}

function relationProps(ctx: OraclePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema,
    table: ctx.table,
    isView: ctx.isView === true,
    sessionLabel: ctx.sessionLabel,
  }
}

function monitorProps(ctx: OraclePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    sessionLabel: ctx.sessionLabel,
  }
}

function designProps(ctx: OraclePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema ?? '',
    table: ctx.table,
    designMode: ctx.designMode === 'create' ? 'create' : 'alter',
    sessionLabel: ctx.sessionLabel,
  }
}

function resolveObjectKind(scope: OraclePaneScope): OracleObjectKind {
  if (
    scope.objectKind === 'view' ||
    scope.objectKind === 'procedure' ||
    scope.objectKind === 'function' ||
    scope.objectKind === 'package'
  ) {
    return scope.objectKind
  }
  if (scope.routineKind === 'procedure' || scope.routineKind === 'function' || scope.routineKind === 'package') {
    return scope.routineKind
  }
  if (scope.isView) return 'view'
  return 'view'
}

function resolveObjectName(scope: OraclePaneScope): string | undefined {
  return scope.objectName || scope.routine || scope.table
}

function objectScriptProps(ctx: OraclePaneContext): Record<string, unknown> {
  const objectKind = resolveObjectKind(ctx)
  const objectName = resolveObjectName(ctx)
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema,
    objectKind,
    objectName,
    designMode: ctx.designMode === 'create' ? 'create' : 'alter',
    initialSql: ctx.initialSql,
    draftSql: ctx.draftSql,
    tabId: ctx.tabId,
    sessionLabel: ctx.sessionLabel,
  }
}

export const oraclePaneRegistry: Record<OracleSessionTab, OracleFeatureDef> = {
  query: {
    icon: 'code-2',
    labelKey: 'modules.oracle.session.tabQuery',
    resolvePane: () => ({
      loader: () => import('@/modules/oracle/components/OracleQueryPane.vue'),
      buildProps: queryProps,
    }),
  },
  browse: {
    icon: 'table',
    labelKey: 'modules.oracle.session.tabBrowse',
    resolvePane: () => ({
      loader: () => import('@/modules/oracle/components/OracleBrowsePane.vue'),
      buildProps: relationProps,
    }),
  },
  ddl: {
    icon: 'file-code',
    labelKey: 'modules.oracle.session.tabDdl',
    resolvePane: () => ({
      loader: () => import('@/modules/oracle/components/OracleDdlPane.vue'),
      buildProps: relationProps,
    }),
  },
  objectScript: {
    icon: 'file-code',
    labelKey: 'modules.oracle.session.tabObjectScript',
    resolvePane: () => ({
      loader: () => import('@/modules/oracle/components/OracleObjectScriptPane.vue'),
      buildProps: objectScriptProps,
    }),
  },
  monitor: {
    icon: 'activity',
    labelKey: 'modules.oracle.session.tabMonitor',
    resolvePane: () => ({
      loader: () => import('@/modules/oracle/components/OracleMonitorPane.vue'),
      buildProps: monitorProps,
    }),
  },
  design: {
    icon: 'layout-list',
    labelKey: 'modules.oracle.session.tabDesign',
    resolvePane: () => ({
      loader: () => import('@/modules/oracle/components/OracleDesignPane.vue'),
      buildProps: designProps,
    }),
  },
}

export function normalizeOracleFeature(tab: string | undefined): OracleSessionTab {
  if (
    tab === 'browse' ||
    tab === 'ddl' ||
    tab === 'query' ||
    tab === 'objectScript' ||
    tab === 'monitor' ||
    tab === 'design'
  ) {
    return tab
  }
  return 'query'
}

/** 自带顶栏的面板（Session 不再叠第二行 header）。 */
export function oracleFeatureEmbedsChrome(tab: OracleSessionTab): boolean {
  return (
    tab === 'query' ||
    tab === 'browse' ||
    tab === 'ddl' ||
    tab === 'objectScript' ||
    tab === 'monitor' ||
    tab === 'design'
  )
}
