/**
 * SQLite Session 功能面板标识。
 * query / browse / ddl / design。
 */

export type SqliteSessionTab = 'query' | 'browse' | 'ddl' | 'design' | 'objectScript'

export interface SqlitePaneScope {
  schema?: string
  table?: string
  isView?: boolean
  /** table | view | index | trigger — 供 meta.ddl 精确匹配 */
  objectType?: string
  designMode?: 'create' | 'alter'
  objectKind?: 'view' | 'trigger' | 'index'
  objectName?: string
  draftSql?: string
}

export interface SqlitePaneContext extends SqlitePaneScope {
  sessionId: string | null
  profileId?: string
  initialSql?: string
  tabId?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
}

export interface SqlitePaneDescriptor {
  loader: () => Promise<{ default: import('vue').Component }>
  buildProps: (ctx: SqlitePaneContext) => Record<string, unknown>
}

export interface SqliteFeatureDef {
  icon: string
  labelKey: string
  resolvePane: (scope: SqlitePaneScope) => SqlitePaneDescriptor
}

function queryProps(ctx: SqlitePaneContext): Record<string, unknown> {
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

function relationProps(ctx: SqlitePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema,
    table: ctx.table,
    isView: ctx.isView === true,
    objectType: ctx.objectType,
    sessionLabel: ctx.sessionLabel,
  }
}

function designProps(ctx: SqlitePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema ?? 'main',
    table: ctx.table,
    designMode: ctx.designMode ?? 'create',
    sessionLabel: ctx.sessionLabel,
  }
}

function objectScriptProps(ctx: SqlitePaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema ?? 'main',
    objectKind: ctx.objectKind ?? (ctx.objectType === 'trigger' || ctx.objectType === 'index' ? ctx.objectType : 'view'),
    objectName: ctx.objectName ?? ctx.table,
    designMode: ctx.designMode ?? (ctx.objectName || ctx.table ? 'alter' : 'create'),
    initialSql: ctx.initialSql,
    draftSql: ctx.draftSql,
    tabId: ctx.tabId,
    sessionLabel: ctx.sessionLabel,
  }
}

export const sqlitePaneRegistry: Record<SqliteSessionTab, SqliteFeatureDef> = {
  query: {
    icon: 'code-2',
    labelKey: 'modules.sqlite.session.tabQuery',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlite/components/SqliteQueryPane.vue'),
      buildProps: queryProps,
    }),
  },
  browse: {
    icon: 'table',
    labelKey: 'modules.sqlite.session.tabBrowse',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlite/components/SqliteBrowsePane.vue'),
      buildProps: relationProps,
    }),
  },
  ddl: {
    icon: 'file-code',
    labelKey: 'modules.sqlite.session.tabDdl',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlite/components/SqliteDdlPane.vue'),
      buildProps: relationProps,
    }),
  },
  design: {
    icon: 'layout-list',
    labelKey: 'modules.sqlite.session.tabDesign',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlite/components/SqliteDesignPane.vue'),
      buildProps: designProps,
    }),
  },
  objectScript: {
    icon: 'file-code',
    labelKey: 'modules.sqlite.session.tabObjectScript',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlite/components/SqliteObjectScriptPane.vue'),
      buildProps: objectScriptProps,
    }),
  },
}

export function normalizeSqliteFeature(tab: string | undefined): SqliteSessionTab {
  if (
    tab === 'browse' ||
    tab === 'ddl' ||
    tab === 'query' ||
    tab === 'design' ||
    tab === 'objectScript'
  ) {
    return tab
  }
  return 'query'
}

/** 自带顶栏的面板（Session 不再叠第二行 header）。 */
export function sqliteFeatureEmbedsChrome(_tab: SqliteSessionTab): boolean {
  return true
}
