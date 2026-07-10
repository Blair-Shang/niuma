import type { ConnKind, ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import type { WorkspaceTab } from '@/stores/tab'

/**
 * 连接导航策略构造的 Tab 规格（L3 → L1 `tabStore.openTab` 入参子集）。
 *
 * `tabId` 由 Tab Store 在 openTab 时生成；`ModuleWorkspace` 渲染时再注入 props。
 */
export interface ConnectionNavTabSpec {
  /** 与模块 registry 的 moduleId / ConnKind 一致 */
  moduleId: ConnKind
  /** TabBar 显示标题 */
  title: string
  /** lucide 图标名 */
  icon: string
  /** 透传给 *Session.vue（至少含 profileId） */
  props: Record<string, unknown>
}

/** `useConnectionNavigation.connect` 可选参数 */
export interface ConnectionNavConnectOptions {
  /**
   * 强制新建 Tab，跳过去重聚焦。
   * 预留：右键「新建会话」、Ctrl+双击等入口。
   */
  forceNew?: boolean
}

/**
 * 连接树 → 工作区 Tab 的协议策略（L3）。
 *
 * ## 职责边界
 *
 * - **本策略**：props / title / 去重规则 / openTab 规格
 * - **不负责**：`session.open/close`（L4 Session Registry）
 * - **不负责**：连接树子节点（`ConnTreeChildProvider`）
 *
 * ## 新增协议步骤（MySQL 示例）
 *
 * 1. 在 `modules/mysql/conn-nav-strategy.ts` 实现并 export `mysqlConnectionNavStrategy`
 * 2. 在 `ops/conn-nav-providers.ts` 调用 `registerConnectionNavStrategy('mysql', ...)`
 * 3. 在 `ops/types.ts` 的 `CONN_KIND_DEFS` 追加 kind
 *
 * `OpsConnectionPanel` / `useConnectionNavigation` **无需修改**。
 *
 * @see docs/18-ops-connection-tree.md §7
 * @see docs/21-session-registry.md §0
 */
export interface ConnectionNavStrategy {
  /** 协议标识，与注册表 key 一致 */
  kind: ConnKind

  /**
   * 连接树「连接 / 双击」时，是否对已打开的同上下文 Tab **聚焦**而非新建。
   *
   * - `false`：每次 `openTab`（SSH / FTP / Redis 允许多 Tab）
   * - `true`：须实现 `findExistingTab`，命中则 `activateTab`
   */
  dedupFocus: boolean

  /**
   * 根据连接项与可选资源路径，构造即将打开的 Tab 规格。
   *
   * @param item - 侧栏连接叶节点
   * @param ctx - 资源子节点双击时携带的 `resourcePath`（如 Redis DB）
   */
  buildTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec

  /**
   * 在 `dedupFocus === true` 时用于查找可聚焦的已有 Tab。
   * 未实现时默认返回 `undefined`（始终新建）。
   */
  findExistingTab?(
    tabs: readonly WorkspaceTab[],
    spec: ConnectionNavTabSpec,
    item: ConnItem,
    ctx?: ConnOpenContext,
  ): WorkspaceTab | undefined
}
