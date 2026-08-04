/**
 * SQL Server 会话面板（P0：仅 query）。
 */

export type SqlServerSessionTab = 'query'

export interface SqlServerPaneScope {
  database?: string
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

export const sqlserverPaneRegistry: Record<SqlServerSessionTab, SqlServerFeatureDef> = {
  query: {
    icon: 'code-2',
    labelKey: 'modules.sqlserver.session.tabQuery',
    resolvePane: () => ({
      loader: () => import('@/modules/sqlserver/components/SqlServerQueryPane.vue'),
      buildProps: queryProps,
    }),
  },
}

export function normalizeSqlServerFeature(tab: string | undefined): SqlServerSessionTab {
  return tab === 'query' ? 'query' : 'query'
}

/** 自带顶栏的面板（Session 不再叠第二行 header）。 */
export function sqlserverFeatureEmbedsChrome(_tab: SqlServerSessionTab): boolean {
  return true
}
