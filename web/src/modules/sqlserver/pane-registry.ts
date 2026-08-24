/**
 * SQL Server 会话面板（query + browse + ddl + objectScript + monitor + design + call）。
 */

import type { SqlServerObjectKind, SqlServerObjectScriptMode } from '@/modules/sqlserver/types/object-script'

export type SqlServerSessionTab =
  | 'query'
  | 'browse'
  | 'ddl'
  | 'objectScript'
  | 'monitor'
  | 'design'
  | 'call'

export interface SqlServerPaneScope {
  database?: string
  schema?: string
  table?: string
  isView?: boolean
  objectKind?: SqlServerObjectKind
  objectName?: string
  routine?: string
  routineKind?: 'procedure' | 'function'
  sequence?: string
  synonym?: string
  designMode?: SqlServerObjectScriptMode
  draftSql?: string
}

export interface SqlServerPaneContext extends SqlServerPaneScope {
  sessionId: string | null
  profileId?: string
  initialSql?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
  tabId?: string
}

export interface SqlServerPaneDescriptor {
  loader: () => Promise<{ default: import('vue').Component }>
  buildProps: (ctx: SqlServerPaneContext) => Record<string, unknown>
}

export interface SqlServerFeatureDef {
  icon: string
  labelKey: string
  resolvePane: (scope?: SqlServerPaneScope) => SqlServerPaneDescriptor
}

function queryProps(ctx: SqlServerPaneContext): Record<string, unknown> {
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

function relationProps(ctx: SqlServerPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    schema: ctx.schema,
    table: ctx.table,
    isView: ctx.isView === true,
    sessionLabel: ctx.sessionLabel,
  }
}

function designProps(ctx: SqlServerPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    schema: ctx.schema,
    table: ctx.table,
    designMode: ctx.designMode === 'create' ? 'create' : 'alter',
    sessionLabel: ctx.sessionLabel,
  }
}

function monitorProps(ctx: SqlServerPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    sessionLabel: ctx.sessionLabel,
  }
}

function callProps(ctx: SqlServerPaneContext): Record<string, unknown> {
  const routineKind =
    ctx.routineKind ??
    (ctx.objectKind === 'function' || ctx.objectKind === 'procedure' ? ctx.objectKind : undefined)
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    schema: ctx.schema,
    routine: ctx.routine ?? ctx.objectName,
    routineKind,
    sessionLabel: ctx.sessionLabel,
  }
}

function objectScriptProps(ctx: SqlServerPaneContext): Record<string, unknown> {
  const objectKind =
    ctx.objectKind ??
    (ctx.synonym ? 'synonym' : undefined) ??
    (ctx.isView ? 'view' : undefined) ??
    'view'
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    schema: ctx.schema,
    objectName: ctx.objectName ?? ctx.routine ?? ctx.sequence ?? ctx.synonym ?? ctx.table,
    objectKind,
    designMode: ctx.designMode ?? 'alter',
    initialSql: ctx.initialSql,
    draftSql: ctx.draftSql,
    sessionLabel: ctx.sessionLabel,
    tabId: ctx.tabId,
  }
}

export const sqlserverPaneRegistry: Record<SqlServerSessionTab, SqlServerFeatureDef> = {
  query: {
    icon: 'code-2',
    labelKey: 'modules.sqlserver.session.tabQuery',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlserver/components/SqlServerQueryPane.vue'),
      buildProps: queryProps,
    }),
  },
  browse: {
    icon: 'table',
    labelKey: 'modules.sqlserver.session.tabBrowse',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlserver/components/SqlServerBrowsePane.vue'),
      buildProps: relationProps,
    }),
  },
  ddl: {
    icon: 'file-code',
    labelKey: 'modules.sqlserver.session.tabDdl',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlserver/components/SqlServerDdlPane.vue'),
      buildProps: relationProps,
    }),
  },
  objectScript: {
    icon: 'file-code',
    labelKey: 'modules.sqlserver.session.tabObjectScript',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlserver/components/SqlServerObjectScriptPane.vue'),
      buildProps: objectScriptProps,
    }),
  },
  monitor: {
    icon: 'activity',
    labelKey: 'modules.sqlserver.session.tabMonitor',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlserver/components/SqlServerMonitorPane.vue'),
      buildProps: monitorProps,
    }),
  },
  design: {
    icon: 'layout-list',
    labelKey: 'modules.sqlserver.session.tabDesign',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlserver/components/SqlServerDesignPane.vue'),
      buildProps: designProps,
    }),
  },
  call: {
    icon: 'play',
    labelKey: 'modules.sqlserver.session.tabCall',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlserver/components/SqlServerDebugPane.vue'),
      buildProps: callProps,
    }),
  },
}

export function normalizeSqlServerFeature(tab: string | undefined): SqlServerSessionTab {
  if (
    tab === 'browse' ||
    tab === 'ddl' ||
    tab === 'objectScript' ||
    tab === 'monitor' ||
    tab === 'design' ||
    tab === 'call'
  ) {
    return tab
  }
  return 'query'
}

/** 自带顶栏的面板（Session 不再叠第二行 header）。 */
export function sqlserverFeatureEmbedsChrome(_tab: SqlServerSessionTab): boolean {
  return true
}
