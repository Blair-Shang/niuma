/**
 * MySQL Session 功能面板标识。
 * P2–P4：query / browse / ddl / source / monitor / design。
 */
export type MysqlSessionTab = 'query' | 'browse' | 'ddl' | 'source' | 'monitor' | 'design'

/** 面板解析所需的静态资源范围。 */
export interface MysqlPaneScope {
  database?: string
  table?: string
  routine?: string
  routineKind?: 'procedure' | 'function'
  /** design 模式：create=新建；alter=修改 */
  designMode?: 'create' | 'alter'
}

export interface MysqlPaneContext extends MysqlPaneScope {
  sessionId: string | null
  profileId?: string
  initialSql?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
}

export interface MysqlPaneDescriptor {
  loader: () => Promise<{ default: import('vue').Component }>
  buildProps: (ctx: MysqlPaneContext) => Record<string, unknown>
}

export interface MysqlFeatureDef {
  icon: string
  labelKey: string
  resolvePane: (scope: MysqlPaneScope) => MysqlPaneDescriptor
}

function queryProps(ctx: MysqlPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    initialSql: ctx.initialSql,
    autoRunInitialSql: ctx.autoRunInitialSql === true,
    sessionLabel: ctx.sessionLabel,
    active: true,
  }
}

function relationProps(ctx: MysqlPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    table: ctx.table,
    sessionLabel: ctx.sessionLabel,
    active: true,
  }
}

function routineProps(ctx: MysqlPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    routine: ctx.routine,
    routineKind: ctx.routineKind,
    sessionLabel: ctx.sessionLabel,
    active: true,
  }
}

function monitorProps(ctx: MysqlPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    sessionLabel: ctx.sessionLabel,
    active: true,
  }
}

function designProps(ctx: MysqlPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database ?? '',
    table: ctx.table,
    designMode: ctx.designMode ?? 'create',
    sessionLabel: ctx.sessionLabel,
    active: true,
  }
}

export const mysqlPaneRegistry: Record<MysqlSessionTab, MysqlFeatureDef> = {
  query: {
    icon: 'code-2',
    labelKey: 'modules.mysql.session.tabQuery',
    resolvePane: () => ({
      loader: () => import('@/modules/mysql/components/MysqlQueryPane.vue'),
      buildProps: queryProps,
    }),
  },
  browse: {
    icon: 'table',
    labelKey: 'modules.mysql.session.tabBrowse',
    resolvePane: () => ({
      loader: () => import('@/modules/mysql/components/MysqlBrowsePane.vue'),
      buildProps: relationProps,
    }),
  },
  ddl: {
    icon: 'file-code',
    labelKey: 'modules.mysql.session.tabDdl',
    resolvePane: () => ({
      loader: () => import('@/modules/mysql/components/MysqlDdlPane.vue'),
      buildProps: relationProps,
    }),
  },
  source: {
    icon: 'workflow',
    labelKey: 'modules.mysql.session.tabSource',
    resolvePane: () => ({
      loader: () => import('@/modules/mysql/components/MysqlSourcePane.vue'),
      buildProps: routineProps,
    }),
  },
  monitor: {
    icon: 'activity',
    labelKey: 'modules.mysql.session.tabMonitor',
    resolvePane: () => ({
      loader: () => import('@/modules/mysql/components/MysqlMonitorPane.vue'),
      buildProps: monitorProps,
    }),
  },
  design: {
    icon: 'layout-list',
    labelKey: 'modules.mysql.session.tabDesign',
    resolvePane: () => ({
      loader: () => import('@/modules/mysql/components/MysqlDesignPane.vue'),
      buildProps: designProps,
    }),
  },
}

export function normalizeMysqlFeature(tab: string | undefined): MysqlSessionTab {
  if (
    tab === 'browse' ||
    tab === 'ddl' ||
    tab === 'query' ||
    tab === 'source' ||
    tab === 'monitor' ||
    tab === 'design'
  ) {
    return tab
  }
  return 'query'
}

/** 自带顶栏的面板（Session 不再叠第二行 header）。 */
export function mysqlFeatureEmbedsChrome(tab: MysqlSessionTab): boolean {
  return (
    tab === 'query' ||
    tab === 'browse' ||
    tab === 'ddl' ||
    tab === 'source' ||
    tab === 'monitor' ||
    tab === 'design'
  )
}
