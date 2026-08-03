/**
 * Vastbase 功能面板注册表
 * ──────────────────────────────────────────────────────────────────────────
 * 架构约定（与连接树 / Tab 导航配合，对齐 Mongo pane-registry）：
 *
 * - 连接树（conn-tree-provider）决定「能打开什么」→ 右键菜单产出 initialTab
 *   · 库节点「工具」子菜单：dumpSql / execSqlFile → 数据任务 Dock；
 *     tools → 本注册表 tools 面板（vb_dump / vb_restore）
 *   · 连接根「工具 / 备份脚本」等同理，经 initialTab 或 openVastbaseDataTask 分流
 * - Tab 导航（conn-nav-strategy）决定「打开的是哪个」→ Tab props 携带
 *   profileId / database / schema / table / routine / initialTab / initialSql
 * - VastSession 只是会话壳（租约 + 顶栏 + 重连），按 initialTab 查本注册表
 *   懒加载渲染唯一面板；embedsChrome 的面板（query/call/browse/debug/monitor/overview/tools）
 *   自带顶栏，Session 不再叠第二行 header
 *
 * 新增功能面板：在此追加一个条目 + conn-tree-provider 加菜单项即可，
 * 无需改 VastSession / OpsConnectionPanel / useConnectionNavigation。
 */
import type { Component } from 'vue'
import type { VastSessionTab } from '@/modules/vastbase/sql-seed'

export type { VastSessionTab }

/** 面板解析所需的静态资源范围（Tab 生命周期内不变）。 */
export interface VastPaneScope {
  database?: string
  schema?: string
  table?: string
  routine?: string
  routineKind?: 'function' | 'procedure'
  /** 例程 identity arguments */
  args?: string
  oid?: number
  designMode?: 'create' | 'alter'
}

/** 构造面板 props 的会话上下文（sessionId / profile 来自响应式源）。 */
export interface VastPaneContext extends VastPaneScope {
  sessionId: string | null
  /** 站点 ID：异步 IO / 工具在无 sessionId 时由 platform 凭据注入 */
  profileId?: string
  initialSql?: string
  /** 查询正文草稿（随 workspace.tabs 持久化） */
  draftSql?: string
  tabId?: string
  /** 带 initialSql 时是否自动执行 */
  autoRunInitialSql?: boolean
  /** 连接显示名（查询/调用/监控等自带顶栏的面板用） */
  sessionLabel?: string
}

/** 单个面板的组件加载与 props 映射。 */
export interface VastPaneDescriptor {
  /** 懒加载组件（dynamic import，按功能拆 chunk） */
  loader: () => Promise<{ default: Component }>
  /** 由会话上下文构造面板 props */
  buildProps: (ctx: VastPaneContext) => Record<string, unknown>
}

/** 功能定义：顶栏徽标元信息 + 面板解析。 */
export interface VastFeatureDef {
  /** lucide / 自定义图标名（顶栏功能徽标） */
  icon: string
  /** 功能名 i18n key（顶栏徽标 + Tab 标题后缀共用） */
  labelKey: string
  /** 依据资源范围选择面板（当前多为 1:1） */
  resolvePane: (scope: VastPaneScope) => VastPaneDescriptor
}

/** 表/视图类面板共用 props（browse / ddl / design）。 */
function relationProps(ctx: VastPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    schema: ctx.schema,
    table: ctx.table,
    active: true,
  }
}

/** 依赖面板：表或例程均可作主体。 */
function depsProps(ctx: VastPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    schema: ctx.schema,
    table: ctx.table,
    routine: ctx.routine,
    routineKind: ctx.routineKind,
    args: ctx.args,
    oid: ctx.oid,
    active: true,
  }
}

/** 表数据浏览：自带顶栏，需连接显示名。 */
function browseProps(ctx: VastPaneContext): Record<string, unknown> {
  return {
    ...relationProps(ctx),
    sessionLabel: ctx.sessionLabel,
  }
}

function designProps(ctx: VastPaneContext): Record<string, unknown> {
  return {
    ...relationProps(ctx),
    designMode: ctx.designMode === 'create' ? 'create' : 'alter',
  }
}

/** 查询 / 调用等需 seed SQL 与完整 scope 的面板。 */
function seedScopeProps(ctx: VastPaneContext, feature: VastSessionTab): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    database: ctx.database,
    schema: ctx.schema,
    table: ctx.table,
    routine: ctx.routine,
    routineKind: ctx.routineKind,
    args: ctx.args,
    oid: ctx.oid,
    feature,
    initialSql: ctx.initialSql,
    draftSql: ctx.draftSql,
    tabId: ctx.tabId,
    autoRunInitialSql: ctx.autoRunInitialSql === true,
    sessionLabel: ctx.sessionLabel,
    active: true,
  }
}

function routineProps(ctx: VastPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    database: ctx.database,
    schema: ctx.schema,
    routine: ctx.routine,
    routineKind: ctx.routineKind,
    args: ctx.args,
    oid: ctx.oid,
    active: true,
  }
}

/** vastPaneRegistry 按功能标识索引全部面板定义（VastSession 的唯一分发依据）。 */
export const vastPaneRegistry: Record<VastSessionTab, VastFeatureDef> = {
  query: {
    icon: 'code-2',
    labelKey: 'modules.vastbase.session.tabQuery',
    resolvePane: () => ({
      loader: () => import('@/modules/vastbase/components/VastQueryPane.vue'),
      buildProps: (ctx) => seedScopeProps(ctx, 'query'),
    }),
  },
  browse: {
    icon: 'table',
    labelKey: 'modules.vastbase.session.tabBrowse',
    resolvePane: () => ({
      loader: () => import('@/modules/vastbase/components/VastBrowsePane.vue'),
      buildProps: browseProps,
    }),
  },
  call: {
    icon: 'play',
    labelKey: 'modules.vastbase.session.tabCall',
    resolvePane: () => ({
      loader: () => import('@/modules/vastbase/components/VastQueryPane.vue'),
      buildProps: (ctx) => seedScopeProps(ctx, 'call'),
    }),
  },
  debug: {
    icon: 'bug',
    labelKey: 'modules.vastbase.session.tabDebug',
    resolvePane: () => ({
      loader: () => import('@/modules/vastbase/components/VastDebugPane.vue'),
      buildProps: routineProps,
    }),
  },
  ddl: {
    icon: 'file-code',
    labelKey: 'modules.vastbase.session.tabDdl',
    resolvePane: () => ({
      loader: () => import('@/modules/vastbase/components/VastDdlPane.vue'),
      buildProps: relationProps,
    }),
  },
  design: {
    icon: 'pencil-ruler',
    labelKey: 'modules.vastbase.session.tabDesign',
    resolvePane: () => ({
      loader: () => import('@/modules/vastbase/components/VastDesignPane.vue'),
      buildProps: designProps,
    }),
  },
  deps: {
    icon: 'git-fork',
    labelKey: 'modules.vastbase.session.tabDeps',
    resolvePane: () => ({
      loader: () => import('@/modules/vastbase/components/VastDepsPane.vue'),
      buildProps: depsProps,
    }),
  },
  overview: {
    icon: 'layout-grid',
    labelKey: 'modules.vastbase.session.tabOverview',
    resolvePane: () => ({
      loader: () => import('@/modules/vastbase/components/VastSchemaOverviewPane.vue'),
      buildProps: (ctx) => ({
        sessionId: ctx.sessionId,
        profileId: ctx.profileId,
        database: ctx.database,
        schema: ctx.schema,
        sessionLabel: ctx.sessionLabel,
        active: true,
      }),
    }),
  },
  monitor: {
    icon: 'activity',
    labelKey: 'modules.vastbase.session.tabMonitor',
    resolvePane: () => ({
      loader: () => import('@/modules/vastbase/components/VastMonitorPane.vue'),
      buildProps: (ctx) => ({
        sessionId: ctx.sessionId,
        profileId: ctx.profileId,
        database: ctx.database,
        sessionLabel: ctx.sessionLabel,
        active: true,
      }),
    }),
  },
  /** 本机 vb_dump / vb_restore；须带 profileId，无 session 时由 platform 注入凭据 */
  tools: {
    icon: 'wrench',
    labelKey: 'modules.vastbase.session.tabTools',
    resolvePane: () => ({
      loader: () => import('@/modules/vastbase/components/VastToolsPane.vue'),
      buildProps: (ctx) => ({
        sessionId: ctx.sessionId,
        profileId: ctx.profileId,
        database: ctx.database,
        sessionLabel: ctx.sessionLabel,
        active: true,
      }),
    }),
  },
  source: {
    icon: 'square-function',
    labelKey: 'modules.vastbase.session.tabFunction',
    resolvePane: () => ({
      loader: () => import('@/modules/vastbase/components/VastSourcePane.vue'),
      buildProps: routineProps,
    }),
  },
}

const FEATURE_SET = new Set<string>(Object.keys(vastPaneRegistry))

export function isVastSessionTab(value: string | undefined): value is VastSessionTab {
  return !!value && FEATURE_SET.has(value)
}

export function normalizeVastFeature(tab: string | undefined): VastSessionTab {
  return isVastSessionTab(tab) ? tab : 'query'
}
