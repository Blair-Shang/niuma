/**
 * Postgres 会话面板（query / browse / ddl / objectScript / monitor / design / call）。
 */

export type PostgresSessionTab =
  | 'query'
  | 'browse'
  | 'ddl'
  | 'objectScript'
  | 'monitor'
  | 'design'
  | 'call'

export interface PostgresPaneScope {
  database?: string
  schema?: string
  table?: string
  isView?: boolean
  routine?: string
  routineKind?: 'function' | 'procedure'
  objectKind?: 'view' | 'materialized_view' | 'function' | 'procedure' | 'sequence' | 'trigger'
  objectName?: string
  sequence?: string
  args?: string
  oid?: number
  designMode?: 'create' | 'alter'
  /** 查询正文草稿（随 workspace.tabs 持久化） */
  draftSql?: string
}

export interface PostgresPaneContext extends PostgresPaneScope {
  sessionId: string | null
  profileId?: string
  initialSql?: string
  autoRunInitialSql?: boolean
  /** 查询执行模式：paged（默认）| batch（同连接） */
  queryExecMode?: 'paged' | 'batch'
  sessionLabel?: string
  tabId?: string
}

export interface PostgresPaneDescriptor {
  loader: () => Promise<{ default: import('vue').Component }>
  buildProps: (ctx: PostgresPaneContext) => Record<string, unknown>
}

export interface PostgresFeatureDef {
  icon: string
  labelKey: string
  resolvePane: (scope?: PostgresPaneScope) => PostgresPaneDescriptor
}

function queryProps(ctx: PostgresPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    schema: ctx.schema,
    initialSql: ctx.initialSql,
    draftSql: ctx.draftSql,
    tabId: ctx.tabId,
    autoRunInitialSql: ctx.autoRunInitialSql === true,
    queryExecMode: ctx.queryExecMode === 'batch' ? 'batch' : ctx.queryExecMode === 'paged' ? 'paged' : undefined,
    sessionLabel: ctx.sessionLabel,
  }
}

function relationProps(ctx: PostgresPaneContext): Record<string, unknown> {
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

function designProps(ctx: PostgresPaneContext): Record<string, unknown> {
  return {
    ...relationProps(ctx),
    designMode: ctx.designMode ?? 'alter',
  }
}

function objectScriptProps(ctx: PostgresPaneContext): Record<string, unknown> {
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
    table: ctx.table,
    args: ctx.args,
    oid: ctx.oid,
    designMode: ctx.designMode ?? 'alter',
    sessionLabel: ctx.sessionLabel,
    tabId: ctx.tabId,
  }
}

export function normalizePostgresFeature(tab?: string): PostgresSessionTab {
  if (
    tab === 'browse' ||
    tab === 'ddl' ||
    tab === 'query' ||
    tab === 'objectScript' ||
    tab === 'monitor' ||
    tab === 'design' ||
    tab === 'call'
  ) {
    return tab
  }
  return 'query'
}

/** Browse / DDL / call 等自绘 chrome；query 用会话壳。 */
export function postgresFeatureEmbedsChrome(feature: PostgresSessionTab): boolean {
  return feature !== 'query'
}

function callProps(ctx: PostgresPaneContext): Record<string, unknown> {
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

export const postgresPaneRegistry: Record<PostgresSessionTab, PostgresFeatureDef> = {
  query: {
    icon: 'terminal',
    labelKey: 'modules.postgres.session.tabQuery',
    resolvePane: () => ({
      loader: () => import('@/modules/postgres/components/PostgresQueryPane.vue'),
      buildProps: queryProps,
    }),
  },
  browse: {
    icon: 'table',
    labelKey: 'modules.postgres.session.tabBrowse',
    resolvePane: () => ({
      loader: () => import('@/modules/postgres/components/PostgresBrowsePane.vue'),
      buildProps: relationProps,
    }),
  },
  ddl: {
    icon: 'file-code',
    labelKey: 'modules.postgres.session.tabDdl',
    resolvePane: () => ({
      loader: () => import('@/modules/postgres/components/PostgresDdlPane.vue'),
      buildProps: relationProps,
    }),
  },
  objectScript: {
    icon: 'file-code',
    labelKey: 'modules.postgres.session.tabObjectScript',
    resolvePane: () => ({ loader: () => import('@/modules/postgres/components/PostgresObjectScriptPane.vue'), buildProps: objectScriptProps }),
  },
  monitor: {
    icon: 'activity',
    labelKey: 'modules.postgres.session.tabMonitor',
    resolvePane: () => ({ loader: () => import('@/modules/postgres/components/PostgresMonitorPane.vue'), buildProps: relationProps }),
  },
  design: {
    icon: 'pencil',
    labelKey: 'modules.postgres.session.tabDesign',
    resolvePane: () => ({
      loader: () => import('@/modules/postgres/components/PostgresDesignPane.vue'),
      buildProps: designProps,
    }),
  },
  call: {
    icon: 'play',
    labelKey: 'modules.postgres.session.tabCall',
    resolvePane: () => ({
      // 对齐 MySQL：入参网格 + 运行调用 + 结果查看（组件名历史为 DebugPane）
      loader: () => import('@/modules/postgres/components/PostgresDebugPane.vue'),
      buildProps: callProps,
    }),
  },
}
