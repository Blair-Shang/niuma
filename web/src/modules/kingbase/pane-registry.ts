/**
 * Kingbase 会话面板（query / browse / ddl / objectScript / monitor / design / debug）。
 */

export type KingbaseSessionTab =
  | 'query'
  | 'browse'
  | 'ddl'
  | 'objectScript'
  | 'monitor'
  | 'design'
  | 'debug'

export interface KingbasePaneScope {
  database?: string
  schema?: string
  table?: string
  isView?: boolean
  routine?: string
  routineKind?: 'function' | 'procedure'
  objectKind?: 'view' | 'function' | 'procedure' | 'sequence'
  objectName?: string
  sequence?: string
  args?: string
  oid?: number
  designMode?: 'create' | 'alter'
}

export interface KingbasePaneContext extends KingbasePaneScope {
  sessionId: string | null
  profileId?: string
  initialSql?: string
  autoRunInitialSql?: boolean
  /** 查询执行模式：paged（默认）| batch（同连接） */
  queryExecMode?: 'paged' | 'batch'
  sessionLabel?: string
  tabId?: string
}

export interface KingbasePaneDescriptor {
  loader: () => Promise<{ default: import('vue').Component }>
  buildProps: (ctx: KingbasePaneContext) => Record<string, unknown>
}

export interface KingbaseFeatureDef {
  icon: string
  labelKey: string
  resolvePane: (scope?: KingbasePaneScope) => KingbasePaneDescriptor
}

function queryProps(ctx: KingbasePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    schema: ctx.schema,
    initialSql: ctx.initialSql,
    autoRunInitialSql: ctx.autoRunInitialSql === true,
    queryExecMode: ctx.queryExecMode === 'batch' ? 'batch' : ctx.queryExecMode === 'paged' ? 'paged' : undefined,
    sessionLabel: ctx.sessionLabel,
  }
}

function relationProps(ctx: KingbasePaneContext): Record<string, unknown> {
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

function designProps(ctx: KingbasePaneContext): Record<string, unknown> {
  return {
    ...relationProps(ctx),
    designMode: ctx.designMode ?? 'alter',
  }
}

function objectScriptProps(ctx: KingbasePaneContext): Record<string, unknown> {
  const objectKind =
    ctx.objectKind ??
    ctx.routineKind ??
    (ctx.isView ? 'view' : undefined) ??
    'view'
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    schema: ctx.schema,
    objectName: ctx.objectName ?? ctx.routine ?? ctx.sequence ?? ctx.table,
    objectKind,
    args: ctx.args,
    oid: ctx.oid,
    designMode: ctx.designMode ?? 'alter',
    sessionLabel: ctx.sessionLabel,
    tabId: ctx.tabId,
  }
}

export function normalizeKingbaseFeature(tab?: string): KingbaseSessionTab {
  if (
    tab === 'browse' ||
    tab === 'ddl' ||
    tab === 'query' ||
    tab === 'objectScript' ||
    tab === 'monitor' ||
    tab === 'design' ||
    tab === 'debug'
  ) {
    return tab
  }
  return 'query'
}

/** Browse / DDL / debug 等自绘 chrome；query 用会话壳。 */
export function kingbaseFeatureEmbedsChrome(feature: KingbaseSessionTab): boolean {
  return feature !== 'query'
}

function debugProps(ctx: KingbasePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    schema: ctx.schema,
    routine: ctx.routine,
    routineKind: ctx.routineKind,
    args: ctx.args,
    oid: ctx.oid,
    sessionLabel: ctx.sessionLabel,
  }
}

export const kingbasePaneRegistry: Record<KingbaseSessionTab, KingbaseFeatureDef> = {
  query: {
    icon: 'terminal',
    labelKey: 'modules.kingbase.session.tabQuery',
    resolvePane: () => ({
      loader: () => import('@/modules/kingbase/components/KingbaseQueryPane.vue'),
      buildProps: queryProps,
    }),
  },
  browse: {
    icon: 'table',
    labelKey: 'modules.kingbase.session.tabBrowse',
    resolvePane: () => ({
      loader: () => import('@/modules/kingbase/components/KingbaseBrowsePane.vue'),
      buildProps: relationProps,
    }),
  },
  ddl: {
    icon: 'file-code',
    labelKey: 'modules.kingbase.session.tabDdl',
    resolvePane: () => ({
      loader: () => import('@/modules/kingbase/components/KingbaseDdlPane.vue'),
      buildProps: relationProps,
    }),
  },
  objectScript: {
    icon: 'file-code',
    labelKey: 'modules.kingbase.session.tabObjectScript',
    resolvePane: () => ({ loader: () => import('@/modules/kingbase/components/KingbaseObjectScriptPane.vue'), buildProps: objectScriptProps }),
  },
  monitor: {
    icon: 'activity',
    labelKey: 'modules.kingbase.session.tabMonitor',
    resolvePane: () => ({ loader: () => import('@/modules/kingbase/components/KingbaseMonitorPane.vue'), buildProps: relationProps }),
  },
  design: {
    icon: 'pencil',
    labelKey: 'modules.kingbase.session.tabDesign',
    resolvePane: () => ({
      loader: () => import('@/modules/kingbase/components/KingbaseDesignPane.vue'),
      buildProps: designProps,
    }),
  },
  debug: {
    icon: 'bug',
    labelKey: 'modules.kingbase.session.tabDebug',
    resolvePane: () => ({
      loader: () => import('@/modules/kingbase/components/KingbaseDebugPane.vue'),
      buildProps: debugProps,
    }),
  },
}
