/**
 * MongoDB 功能面板注册表
 * ──────────────────────────────────────────────────────────────────────────
 * 架构约定（与连接树 / Tab 导航配合）：
 *
 * - 连接树（conn-tree-provider）决定「能打开什么」→ 右键菜单产出 initialTab
 * - Tab 导航（conn-nav-strategy）决定「打开的是哪个」→ Tab props 携带
 *   profileId / database / collection / initialTab
 * - MongoSession 只是会话壳（租约 + 顶栏 + 重连），按 initialTab 查本注册表
 *   懒加载渲染唯一面板
 *
 * 新增功能面板：在此追加一个条目 + conn-tree-provider 加菜单项即可，
 * 无需改 MongoSession / OpsConnectionPanel / useConnectionNavigation。
 */
import type { Component } from 'vue'

/** MongoSessionTab 表示 MongoDB 会话 Tab 承载的功能（一个工作区 Tab 固定一个功能）。 */
export type MongoSessionTab =
  | 'collections'
  | 'query'
  | 'schema'
  | 'indexes'
  | 'live'
  | 'tools'
  | 'console'
  | 'monitor'

/** MongoPaneScope 是面板解析所需的静态资源范围（Tab 生命周期内不变）。 */
export interface MongoPaneScope {
  database?: string
  collection?: string
}

/** MongoPaneContext 是构造面板 props 的会话上下文（sessionId / profile 来自响应式源）。 */
export interface MongoPaneContext extends MongoPaneScope {
  sessionId: string | null
  hostAddress?: string
  portNumber?: number
  /** 从数据库概览打开某集合的功能 Tab（经 L3 连接导航新建/聚焦） */
  openCollection: (database: string, collection: string, feature: string) => void
}

/** MongoPaneDescriptor 描述单个面板的组件加载与 props 映射。 */
export interface MongoPaneDescriptor {
  /** 懒加载组件（dynamic import，按功能拆 chunk） */
  loader: () => Promise<{ default: Component }>
  /** 由会话上下文构造面板 props（含 onXxx 事件监听） */
  buildProps: (ctx: MongoPaneContext) => Record<string, unknown>
}

/** MongoFeatureDef 是功能定义：顶栏徽标元信息 + 面板解析。 */
export interface MongoFeatureDef {
  /** lucide 图标名（顶栏功能徽标） */
  icon: string
  /** 功能名 i18n key（顶栏徽标 + Tab 标题后缀共用） */
  labelKey: string
  /** 依据资源范围选择面板（collections 按是否选中集合分流） */
  resolvePane: (scope: MongoPaneScope) => MongoPaneDescriptor
}

/** query / schema / live / tools 共用的 initial* props 映射。 */
function initialScopeProps(ctx: MongoPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    initialDatabase: ctx.database,
    initialCollection: ctx.collection,
    scopeLocked: !!(ctx.database && ctx.collection),
    active: true,
  }
}

/** mongoPaneRegistry 按功能标识索引全部面板定义（MongoSession 的唯一分发依据）。 */
export const mongoPaneRegistry: Record<MongoSessionTab, MongoFeatureDef> = {
  collections: {
    icon: 'table-2',
    labelKey: 'modules.mongodb.session.tabCollections',
    // 只有数据库（无集合）→ 数据库概览；否则 → 文档浏览
    resolvePane: (scope) =>
      scope.database && !scope.collection
        ? {
            loader: () => import('@/modules/mongodb/components/MongoDatabasePane.vue'),
            buildProps: (ctx) => ({
              sessionId: ctx.sessionId,
              database: ctx.database,
              active: true,
              onOpenCollection: (collection: string, feature: string) =>
                ctx.openCollection(ctx.database!, collection, feature),
            }),
          }
        : {
            loader: () => import('@/modules/mongodb/components/MongoCollectionsPane.vue'),
            buildProps: (ctx) => ({
              sessionId: ctx.sessionId,
              database: ctx.database,
              collection: ctx.collection,
              active: true,
            }),
          },
  },
  query: {
    icon: 'code-2',
    labelKey: 'modules.mongodb.session.tabQuery',
    resolvePane: () => ({
      loader: () => import('@/modules/mongodb/components/MongoQueryPane.vue'),
      buildProps: initialScopeProps,
    }),
  },
  schema: {
    icon: 'list-tree',
    labelKey: 'modules.mongodb.session.tabSchema',
    resolvePane: () => ({
      loader: () => import('@/modules/mongodb/components/MongoSchemaPane.vue'),
      buildProps: initialScopeProps,
    }),
  },
  indexes: {
    icon: 'list-ordered',
    labelKey: 'modules.mongodb.session.tabIndexes',
    resolvePane: () => ({
      loader: () => import('@/modules/mongodb/components/MongoIndexesPane.vue'),
      buildProps: (ctx) => ({
        sessionId: ctx.sessionId,
        database: ctx.database,
        collection: ctx.collection,
        active: true,
      }),
    }),
  },
  live: {
    icon: 'radio',
    labelKey: 'modules.mongodb.session.tabLive',
    resolvePane: () => ({
      loader: () => import('@/modules/mongodb/components/MongoLivePane.vue'),
      buildProps: initialScopeProps,
    }),
  },
  tools: {
    icon: 'wrench',
    labelKey: 'modules.mongodb.session.tabTools',
    resolvePane: () => ({
      loader: () => import('@/modules/mongodb/components/MongoToolsPane.vue'),
      buildProps: initialScopeProps,
    }),
  },
  console: {
    icon: 'terminal',
    labelKey: 'modules.mongodb.session.tabConsole',
    resolvePane: () => ({
      loader: () => import('@/modules/mongodb/components/MongoConsolePane.vue'),
      buildProps: (ctx) => ({
        sessionId: ctx.sessionId,
        hostAddress: ctx.hostAddress,
        portNumber: ctx.portNumber,
      }),
    }),
  },
  monitor: {
    icon: 'activity',
    labelKey: 'modules.mongodb.session.tabMonitor',
    resolvePane: () => ({
      loader: () => import('@/modules/mongodb/components/MongoMonitorPane.vue'),
      buildProps: (ctx) => ({
        sessionId: ctx.sessionId,
        database: ctx.database,
        active: true,
      }),
    }),
  },
}
