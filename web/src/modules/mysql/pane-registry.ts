/**
 * MySQL Session 功能面板标识。
 * query / browse / ddl / objectScript / monitor / design / tools / debug。
 */
import type { MysqlObjectKind, MysqlObjectScriptMode } from '@/modules/mysql/types/object-script'

export type MysqlSessionTab =
  | 'query'
  | 'browse'
  | 'ddl'
  | 'objectScript'
  | 'monitor'
  | 'design'
  | 'tools'
  | 'debug'

/** 面板解析所需的静态资源范围。 */
export interface MysqlPaneScope {
  database?: string
  table?: string
  routine?: string
  routineKind?: 'procedure' | 'function'
  /** design / objectScript：create=新建；alter=修改 */
  designMode?: MysqlObjectScriptMode
  /** 对象脚本：视图 / 过程 / 函数 */
  objectKind?: MysqlObjectKind
  /** 对象脚本目标名（create 可为占位名） */
  objectName?: string
}

export interface MysqlPaneContext extends MysqlPaneScope {
  sessionId: string | null
  profileId?: string
  initialSql?: string
  /** 对象脚本未保存正文（Tab 持久化，应用重启恢复） */
  draftSql?: string
  tabId?: string
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
    draftSql: ctx.draftSql,
    tabId: ctx.tabId,
    autoRunInitialSql: ctx.autoRunInitialSql === true,
    sessionLabel: ctx.sessionLabel,
  }
}

function relationProps(ctx: MysqlPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    table: ctx.table,
    sessionLabel: ctx.sessionLabel,
  }
}

function debugProps(ctx: MysqlPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    routine: ctx.routine,
    routineKind: ctx.routineKind,
    sessionLabel: ctx.sessionLabel,
  }
}

function objectScriptProps(ctx: MysqlPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    objectKind: ctx.objectKind ?? 'view',
    objectName: ctx.objectName ?? ctx.table ?? ctx.routine,
    designMode: ctx.designMode ?? 'alter',
    initialSql: ctx.initialSql,
    draftSql: ctx.draftSql,
    tabId: ctx.tabId,
    sessionLabel: ctx.sessionLabel,
  }
}

function monitorProps(ctx: MysqlPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
  }
}

function toolsProps(ctx: MysqlPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    sessionLabel: ctx.sessionLabel,
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
  objectScript: {
    icon: 'file-code',
    labelKey: 'modules.mysql.session.tabObjectScript',
    resolvePane: () => ({
      loader: () => import('@/modules/mysql/components/MysqlObjectScriptPane.vue'),
      buildProps: objectScriptProps,
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
  tools: {
    icon: 'wrench',
    labelKey: 'modules.mysql.session.tabTools',
    resolvePane: () => ({
      loader: () => import('@/modules/mysql/components/MysqlToolsPane.vue'),
      buildProps: toolsProps,
    }),
  },
  debug: {
    icon: 'bug',
    labelKey: 'modules.mysql.session.tabDebug',
    resolvePane: () => ({
      loader: () => import('@/modules/mysql/components/MysqlDebugPane.vue'),
      buildProps: debugProps,
    }),
  },
}

export function normalizeMysqlFeature(tab: string | undefined): MysqlSessionTab {
  if (
    tab === 'browse' ||
    tab === 'ddl' ||
    tab === 'query' ||
    tab === 'objectScript' ||
    tab === 'monitor' ||
    tab === 'design' ||
    tab === 'tools' ||
    tab === 'debug'
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
    tab === 'objectScript' ||
    tab === 'monitor' ||
    tab === 'design' ||
    tab === 'tools' ||
    tab === 'debug'
  )
}
