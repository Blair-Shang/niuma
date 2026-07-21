/**
 * 工作区 Tab 状态 — **L1：Tab Store**（编辑区多实例 + 多编辑组）。
 *
 * ## Tab 管理四层模型
 *
 * | 层 | 本文件角色 | 职责 |
 * |----|------------|------|
 * | **L1** | `tab.ts`（本 Store） | `tabId` / `moduleId` / `props` / 编辑组 / Platform 持久化 |
 * | **L2** | `ModuleWorkspace.vue` | 每组渲染激活 Tab；`<keep-alive>` 保活 UI，关 Tab 不保证 unmount |
 * | **L3** | `useConnectionNavigation` + `connection-nav` | 连接树 → `openTab`；策略在 `conn-nav-strategy.ts` |
 * | **L4** | `session-registry.ts` | `acquire` / `release`；唯一管理 `session.open/close` 的 Web 入口 |
 *
 * **本 Store 只管 UI 页签元数据，不触碰 Layer-1 物理连接。**
 * `closeTab` 仅从 `groups` 删除条目；释放 Layer-1 会话由 L4 `sessionRegistry.release(tabId)` 完成。
 *
 * 层级：workspace → groups[]（编辑组，横向分屏）→ 每组 tabs[]（该组内的多个实例）。
 * 每个 Tab 是某模块的一个独立实例；`ModuleWorkspace` 为**每个组**各用一个
 * `<keep-alive>` 按 tabId 保活其激活 Tab。路由只反映「全局激活 Tab 属于哪个模块」。
 *
 * 持久化由 **Platform 层**唯一负责（SQLite `nm_app_setting`，键 `workspace.tabs`，
 * 经 `platform.settings.*` 桥接；壳层仅透传不落盘）。桌面端 Platform 进程由壳层
 * 自动拉起、始终可用，故**不设 localStorage 缓存/回退**：应用挂载前 `await hydrate()`
 * 一次即完成首屏恢复。恢复时丢弃已卸载模块、复位 dirty、重算插件 props，并兼容
 * 旧的单组结构。
 *
 * @see docs/09-web-app-shell.md 第 6 节「Tab 工作区」
 * @see docs/21-session-registry.md §0「Tab 管理架构总览」
 * @see docs/11-platform-core.md Platform 层持久化
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { isBridgeAvailable, settingsApi } from '@/api'
import {
  getExtensionRoot,
  getExtensionUiEntry,
  getModuleById,
} from '@/extensions/registry/extension-registry'
import { SETTINGS_VIEW_ID, getInternalView, isInternalViewId } from '@/shell/internal-views'
import { useSessionRegistry } from '@/stores/session-registry'

/** Platform 层 KV 键（SQLite nm_app_setting，唯一权威存储） */
const SETTING_KEY = 'workspace.tabs'

/** 单个工作区 Tab */
export interface WorkspaceTab {
  tabId: string
  /** 所属模块 id（ssh / database / 插件 id …） */
  moduleId: string
  /** 自定义标题（如会话主机名）；存在时优先于 titleKey */
  title?: string
  /** i18n 标题键；默认取模块 labelKey，随语言切换自动更新 */
  titleKey?: string
  /** lucide 图标名，默认取模块 icon */
  icon?: string
  /** 是否可关闭 */
  closable: boolean
  /** 未保存标记，TabBar 显示圆点 */
  dirty: boolean
  /** 悬浮提示（含完整连接信息，如 host + db），优先于 tabLabel 用于 title 属性 */
  tooltip?: string
  /** 透传给模块组件的 props（扩展模块含 pluginRoot / pluginUiEntry） */
  props: Record<string, unknown>
}

/** 编辑组（一个横向分屏面板，含该组的 Tab 列表与激活项） */
export interface EditorGroup {
  groupId: string
  tabs: WorkspaceTab[]
  activeTabId: string | null
  /** 分屏布局伸缩系数（宽度比例），默认 1 */
  grow: number
}

/** openTab 入参：仅 moduleId 必填，其余走模块默认值 */
export interface OpenTabSpec {
  moduleId: string
  title?: string
  titleKey?: string
  icon?: string
  closable?: boolean
  /** 悬浮提示（含完整连接信息），优先于 tabLabel 用于 title 属性 */
  tooltip?: string
  props?: Record<string, unknown>
  /** 指定 tabId（用于持久化恢复），默认随机 */
  tabId?: string
}

/** openModule 选项 */
export interface OpenModuleOptions {
  /** 强制新开一个实例；默认聚焦已存在的同模块 Tab */
  forceNew?: boolean
  title?: string
  props?: Record<string, unknown>
}

/** 持久化状态 */
interface PersistedState {
  groups: EditorGroup[]
  activeGroupId: string
}

/**
 * 为模块构造默认 props：扩展模块需要 pluginRoot / pluginUiEntry 才能挂载 UI，
 * 内置模块无额外 props。
 *
 * @param moduleId - 模块 id
 */
function defaultModuleProps(moduleId: string): Record<string, unknown> {
  const root = getExtensionRoot(moduleId)
  if (!root) {
    return {}
  }
  return {
    pluginRoot: root,
    pluginUiEntry: getExtensionUiEntry(moduleId) ?? '',
    moduleId,
  }
}

/**
 * 按规格构造一个新 Tab（合并模块默认值与默认 props）。
 *
 * @param spec - Tab 规格，moduleId 必填
 */
function buildTab(spec: OpenTabSpec): WorkspaceTab {
  const descriptor = getModuleById(spec.moduleId)
  return {
    tabId: spec.tabId ?? crypto.randomUUID(),
    moduleId: spec.moduleId,
    title: spec.title,
    titleKey: spec.titleKey ?? (spec.title ? undefined : descriptor?.labelKey),
    icon: spec.icon ?? descriptor?.icon,
    closable: spec.closable ?? true,
    dirty: false,
    tooltip: spec.tooltip,
    props: { ...defaultModuleProps(spec.moduleId), ...spec.props },
  }
}

/** 新建一个空编辑组 */
function makeGroup(tabs: WorkspaceTab[] = [], activeTabId: string | null = null): EditorGroup {
  return { groupId: crypto.randomUUID(), tabs, activeTabId, grow: 1 }
}

/** 恢复单个 Tab：保留 tabId、复位 dirty、重算插件 props */
function restoreTab(t: WorkspaceTab): WorkspaceTab {
  return {
    tabId: t.tabId,
    moduleId: t.moduleId,
    title: t.title,
    titleKey: t.titleKey,
    icon: t.icon,
    closable: t.closable ?? true,
    dirty: false,
    tooltip: t.tooltip,
    props: { ...t.props, ...defaultModuleProps(t.moduleId) },
  }
}

function isValidTab(t: WorkspaceTab): boolean {
  return (
    Boolean(t) &&
    typeof t.tabId === 'string' &&
    (Boolean(getModuleById(t.moduleId)) || isInternalViewId(t.moduleId))
  )
}

/**
 * 规整持久化数据：兼容旧单组结构；丢弃已卸载模块与空组；保证至少一个组。
 *
 * @param raw - 反序列化后的原始对象
 */
function normalizeState(raw: unknown): PersistedState {
  const parsed = (raw ?? {}) as {
    groups?: Array<Partial<EditorGroup>>
    tabs?: WorkspaceTab[]
    activeTabId?: string | null
    activeGroupId?: string
  }

  let rawGroups: Array<Partial<EditorGroup>> = []
  if (Array.isArray(parsed.groups)) {
    rawGroups = parsed.groups
  } else if (Array.isArray(parsed.tabs)) {
    // 兼容旧的单组结构（{ tabs, activeTabId }）→ 包成一个编辑组
    rawGroups = [{ tabs: parsed.tabs, activeTabId: parsed.activeTabId, grow: 1 }]
  }

  const groups: EditorGroup[] = []
  for (const g of rawGroups) {
    const tabs = (g.tabs ?? []).filter(isValidTab).map(restoreTab)
    if (!tabs.length) {
      continue
    }
    const activeTabId = tabs.find((t) => t.tabId === g.activeTabId)?.tabId ?? tabs[0].tabId
    groups.push({
      groupId: typeof g.groupId === 'string' ? g.groupId : crypto.randomUUID(),
      tabs,
      activeTabId,
      grow: typeof g.grow === 'number' && g.grow > 0 ? g.grow : 1,
    })
  }

  if (!groups.length) {
    groups.push(makeGroup())
  }
  const activeGroupId =
    groups.find((g) => g.groupId === parsed.activeGroupId)?.groupId ?? groups[0].groupId
  return { groups, activeGroupId }
}

/**
 * 从 Platform（SQLite）读取工作区状态。桌面端 Platform 始终可用；无桥接的纯浏览器
 * dev 环境返回空状态（单个空编辑组）。
 */
async function readPersistedState(): Promise<PersistedState> {
  if (!isBridgeAvailable()) {
    return normalizeState(null)
  }
  try {
    const res = await settingsApi.get(SETTING_KEY)
    return normalizeState(res.value ? JSON.parse(res.value) : null)
  } catch (err) {
    // Platform 服务尚未就绪（dev:hot 启动时序或未运行），静默回退空状态
    if (isServiceUnavailable(err)) {
      return normalizeState(null)
    }
    throw err
  }
}

/**
 * 写入 Platform（SQLite）。壳层仅透传 gRPC，不落盘、不解析业务。
 *
 * @param state - 当前状态
 */
/** 判断是否为 Platform 服务不可用错误（壳层 bridge 返回 "service unavailable: …"）。 */
function isServiceUnavailable(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('service unavailable')
}

function writePersistedState(state: PersistedState): void {
  if (!isBridgeAvailable()) {
    return
  }
  settingsApi.set(SETTING_KEY, JSON.stringify(state)).catch((error: unknown) => {
    if (isServiceUnavailable(error)) {
      return
    }
    console.warn('[tab] platform settings save failed', error)
  })
}

export const useTabStore = defineStore('tab', () => {
  // 初始为空（单个空编辑组）；真实状态由挂载前 await hydrate() 从 Platform 填充
  const initial = normalizeState(null)
  const groups = ref<EditorGroup[]>(initial.groups)
  const activeGroupId = ref<string>(initial.activeGroupId)

  /** 当前激活的编辑组（保证非空，回退到首个组） */
  const activeGroup = computed<EditorGroup>(
    () => groups.value.find((g) => g.groupId === activeGroupId.value) ?? groups.value[0],
  )

  /** 全局激活 Tab（激活组的激活 Tab） */
  const activeTab = computed<WorkspaceTab | null>(() => {
    const g = activeGroup.value
    return g.tabs.find((t) => t.tabId === g.activeTabId) ?? null
  })

  /** 激活组的激活 tabId */
  const activeTabId = computed<string | null>(() => activeGroup.value.activeTabId)

  /** 所有组的 Tab 扁平集合（跨组查询/统计用） */
  const allTabs = computed<WorkspaceTab[]>(() => groups.value.flatMap((g) => g.tabs))

  // 挂载前是否已完成首屏恢复；hydrate 完成前不回写，避免用空状态覆盖 Platform 数据
  let hydrated = false

  /**
   * 从 Platform 读取并填充工作区状态（幂等，应用挂载前 `await` 一次以避免首屏闪动）。
   * 读取失败时保持当前（空）状态，不阻塞挂载。
   */
  async function hydrate(): Promise<void> {
    try {
      const state = await readPersistedState()
      groups.value = state.groups
      activeGroupId.value = state.activeGroupId
    } catch (error) {
      console.warn('[tab] hydrate failed', error)
    } finally {
      hydrated = true
    }
  }

  // 恢复完成后，状态变化即写回 Platform（下次启动恢复）
  watch(
    [groups, activeGroupId],
    () => {
      if (hydrated) {
        writePersistedState({ groups: groups.value, activeGroupId: activeGroupId.value })
      }
    },
    { deep: true },
  )

  /** 找到包含指定 tabId 的组 */
  function groupOfTab(tabId: string): EditorGroup | undefined {
    return groups.value.find((g) => g.tabs.some((t) => t.tabId === tabId))
  }

  /** 校准某组激活项：激活项不存在时回退到 fallbackId 或首个 Tab */
  function ensureGroupActive(group: EditorGroup, fallbackId?: string): void {
    if (group.tabs.some((t) => t.tabId === group.activeTabId)) {
      return
    }
    const fallback = fallbackId && group.tabs.some((t) => t.tabId === fallbackId) ? fallbackId : null
    group.activeTabId = fallback ?? group.tabs[0]?.tabId ?? null
  }

  /** 移除空组（保留至少一个组）；若激活组被移除则改激活相邻组 */
  function pruneEmptyGroups(): void {
    if (groups.value.length <= 1) {
      return
    }
    const remaining = groups.value.filter((g) => g.tabs.length > 0)
    if (!remaining.length) {
      const only = groups.value[0]
      only.tabs = []
      only.activeTabId = null
      groups.value = [only]
      activeGroupId.value = only.groupId
      return
    }
    if (remaining.length !== groups.value.length) {
      const activeKept = remaining.some((g) => g.groupId === activeGroupId.value)
      groups.value = remaining
      if (!activeKept) {
        activeGroupId.value = remaining[0].groupId
      }
    }
  }

  /**
   * 新开一个 Tab 实例并激活（始终创建，加入当前激活组）。
   *
   * 连接树场景由 L3 `useConnectionNavigation` 先去重，必要时才调用本方法。
   * 物理会话 `session.open` 不在此触发（规划由 L4 `acquire(tabId)` 负责）。
   *
   * @param spec - Tab 规格，moduleId 必填
   * @returns 新 Tab 的 tabId
   */
  function openTab(spec: OpenTabSpec): string {
    const tab = buildTab(spec)
    const group = activeGroup.value
    group.tabs.push(tab)
    group.activeTabId = tab.tabId
    activeGroupId.value = group.groupId
    return tab.tabId
  }

  /**
   * 打开「设置」内置视图 Tab（VS Code 式：设置是编辑器页签而非整页覆盖）。
   * 全局单例：已存在则聚焦（可能跨组），否则在当前组新建。
   *
   * @param options.section - 初始分区 id（如 ai-providers / ai-mcp / ai-skills）
   * @returns 设置 Tab 的 tabId
   */
  function openSettings(options?: { section?: string }): string {
    const existing = allTabs.value.find((t) => t.moduleId === SETTINGS_VIEW_ID)
    if (existing) {
      activateTab(existing.tabId)
      if (options?.section) {
        updateTabProps(existing.tabId, { section: options.section })
      }
      return existing.tabId
    }
    const view = getInternalView(SETTINGS_VIEW_ID)
    return openTab({
      moduleId: SETTINGS_VIEW_ID,
      titleKey: view?.titleKey,
      icon: view?.icon,
      props: options?.section ? { section: options.section } : undefined,
    })
  }

  /**
   * 打开模块：默认聚焦已存在的同模块 Tab（优先当前组），没有则在当前组新建；
   * `forceNew` 时总是新建。
   *
   * @param moduleId - 模块 id
   * @param options - 是否强制新建、自定义标题与 props
   * @returns 目标 Tab 的 tabId
   */
  function openModule(moduleId: string, options: OpenModuleOptions = {}): string {
    if (!options.forceNew) {
      const inActive = activeGroup.value.tabs.find((t) => t.moduleId === moduleId)
      const existing = inActive ?? allTabs.value.find((t) => t.moduleId === moduleId)
      if (existing) {
        activateTab(existing.tabId)
        return existing.tabId
      }
    }
    return openTab({ moduleId, title: options.title, props: options.props })
  }

  /**
   * 激活指定 Tab（并把其所在组设为激活组）。
   *
   * @param tabId - 目标 Tab id
   */
  function activateTab(tabId: string): void {
    const group = groupOfTab(tabId)
    if (!group) {
      return
    }
    group.activeTabId = tabId
    activeGroupId.value = group.groupId
  }

  /**
   * 设为激活组（点击某组任意处时）。
   *
   * @param groupId - 目标组 id
   */
  function setActiveGroup(groupId: string): void {
    if (groups.value.some((g) => g.groupId === groupId)) {
      activeGroupId.value = groupId
    }
  }

  /** 关闭 Tab 前释放 Layer-1 会话借用（L4） */
  function releaseTabs(tabIds: string[]): void {
    if (tabIds.length === 0) {
      return
    }
    void useSessionRegistry().releaseMany(tabIds)
  }

  /**
   * 关闭 Tab（L1 删条目 + L4 release）。
   *
   * @param tabId - 目标 Tab id
   */
  function closeTab(tabId: string): void {
    releaseTabs([tabId])
    const group = groupOfTab(tabId)
    if (!group) {
      return
    }
    const index = group.tabs.findIndex((t) => t.tabId === tabId)
    group.tabs.splice(index, 1)
    if (group.activeTabId === tabId) {
      const neighbor = group.tabs[index - 1] ?? group.tabs[index] ?? group.tabs[0]
      group.activeTabId = neighbor?.tabId ?? null
    }
    pruneEmptyGroups()
  }

  /**
   * 关闭同组内除指定 Tab 外的所有可关闭 Tab。
   *
   * @param tabId - 需保留的 Tab id
   */
  function closeOthers(tabId: string): void {
    const group = groupOfTab(tabId)
    if (!group) {
      return
    }
    const toRelease = group.tabs.filter((t) => t.tabId !== tabId && t.closable).map((t) => t.tabId)
    releaseTabs(toRelease)
    group.tabs = group.tabs.filter((t) => t.tabId === tabId || !t.closable)
    ensureGroupActive(group, tabId)
  }

  /**
   * 关闭同组内指定 Tab 右侧的所有可关闭 Tab。
   *
   * @param tabId - 基准 Tab id
   */
  function closeToRight(tabId: string): void {
    const group = groupOfTab(tabId)
    if (!group) {
      return
    }
    const index = group.tabs.findIndex((t) => t.tabId === tabId)
    if (index === -1) {
      return
    }
    const toRelease = group.tabs.filter((t, i) => i > index && t.closable).map((t) => t.tabId)
    releaseTabs(toRelease)
    group.tabs = group.tabs.filter((t, i) => i <= index || !t.closable)
    ensureGroupActive(group, tabId)
  }

  /**
   * 关闭某组（默认按 tabId 定位组，否则激活组）内所有可关闭 Tab。
   *
   * @param tabId - 组内任一 Tab id，可选
   */
  function closeAll(tabId?: string): void {
    const group = tabId ? groupOfTab(tabId) : activeGroup.value
    if (!group) {
      return
    }
    const toRelease = group.tabs.filter((t) => t.closable).map((t) => t.tabId)
    releaseTabs(toRelease)
    group.tabs = group.tabs.filter((t) => !t.closable)
    ensureGroupActive(group)
    pruneEmptyGroups()
  }

  /**
   * 组内拖拽排序：把 Tab 移动到同组目标下标。
   *
   * @param tabId - 被拖拽的 Tab id
   * @param toIndex - 目标下标（越界自动夹取）
   */
  function moveTab(tabId: string, toIndex: number): void {
    const group = groupOfTab(tabId)
    if (!group) {
      return
    }
    const from = group.tabs.findIndex((t) => t.tabId === tabId)
    const to = Math.max(0, Math.min(toIndex, group.tabs.length - 1))
    if (from === -1 || from === to) {
      return
    }
    const [moved] = group.tabs.splice(from, 1)
    group.tabs.splice(to, 0, moved)
  }

  /**
   * 跨组移动 Tab（拖到另一编辑组）。同组时退化为 `moveTab`。
   *
   * @param tabId - 被拖拽的 Tab id
   * @param targetGroupId - 目标组 id
   * @param toIndex - 目标组内下标，默认追加到末尾
   */
  function moveTabToGroup(tabId: string, targetGroupId: string, toIndex?: number): void {
    const src = groupOfTab(tabId)
    const dst = groups.value.find((g) => g.groupId === targetGroupId)
    if (!src || !dst) {
      return
    }
    if (src.groupId === dst.groupId) {
      if (toIndex !== undefined) {
        moveTab(tabId, toIndex)
      }
      return
    }
    const from = src.tabs.findIndex((t) => t.tabId === tabId)
    const [moved] = src.tabs.splice(from, 1)
    const at = Math.max(0, Math.min(toIndex ?? dst.tabs.length, dst.tabs.length))
    dst.tabs.splice(at, 0, moved)
    dst.activeTabId = moved.tabId
    if (src.activeTabId === tabId) {
      const neighbor = src.tabs[from - 1] ?? src.tabs[from] ?? src.tabs[0]
      src.activeTabId = neighbor?.tabId ?? null
    }
    activeGroupId.value = dst.groupId
    pruneEmptyGroups()
  }

  /**
   * 分屏：在指定组（默认激活组）右侧新建一个编辑组，并在其中打开当前激活 Tab
   * 所属模块的一个新实例（可与原实例并排对比）。
   *
   * @param groupId - 源组 id，可选
   * @returns 新组 id
   */
  function splitGroup(groupId?: string): string {
    const src = groupId ? groups.value.find((g) => g.groupId === groupId) : activeGroup.value
    const active = src?.tabs.find((t) => t.tabId === src.activeTabId)
    // 无可分屏内容（空组）时不产生游离空组
    if (!src || !active) {
      return activeGroupId.value
    }
    const newGroup = makeGroup()
    const srcIndex = groups.value.indexOf(src)
    groups.value.splice(srcIndex + 1, 0, newGroup)
    activeGroupId.value = newGroup.groupId
    openTab({ moduleId: active.moduleId, title: active.title, props: { ...active.props } })
    return newGroup.groupId
  }

  /**
   * 关闭整个编辑组；若是最后一组则仅清空其可关闭 Tab。
   *
   * @param groupId - 目标组 id
   */
  function closeGroup(groupId: string): void {
    const group = groups.value.find((g) => g.groupId === groupId)
    if (!group) {
      return
    }
    if (groups.value.length <= 1) {
      const toRelease = group.tabs.filter((t) => t.closable).map((t) => t.tabId)
      releaseTabs(toRelease)
      group.tabs = group.tabs.filter((t) => !t.closable)
      ensureGroupActive(group)
      return
    }
    const toRelease = group.tabs.map((t) => t.tabId)
    releaseTabs(toRelease)
    const index = groups.value.findIndex((g) => g.groupId === groupId)
    if (index === -1) {
      return
    }
    groups.value.splice(index, 1)
    if (activeGroupId.value === groupId) {
      const neighbor = groups.value[index - 1] ?? groups.value[index] ?? groups.value[0]
      activeGroupId.value = neighbor.groupId
    }
  }

  /**
   * 设置分屏两侧组的伸缩系数（拖拽分隔条时调用）。
   *
   * @param leftId - 左组 id
   * @param leftGrow - 左组新 grow
   * @param rightId - 右组 id
   * @param rightGrow - 右组新 grow
   */
  function resizeGroups(leftId: string, leftGrow: number, rightId: string, rightGrow: number): void {
    const left = groups.value.find((g) => g.groupId === leftId)
    const right = groups.value.find((g) => g.groupId === rightId)
    if (left) {
      left.grow = Math.max(0.2, leftGrow)
    }
    if (right) {
      right.grow = Math.max(0.2, rightGrow)
    }
  }

  /**
   * 设置 Tab 的未保存标记。
   *
   * @param tabId - 目标 Tab id
   * @param dirty - 是否有未保存改动
   */
  function setDirty(tabId: string, dirty: boolean): void {
    const tab = allTabs.value.find((t) => t.tabId === tabId)
    if (tab) {
      tab.dirty = dirty
    }
  }

  /**
   * 更新 Tab 标题（设为自定义标题，清除 i18n 键）。
   *
   * @param tabId - 目标 Tab id
   * @param title - 新标题
   */
  function updateTitle(tabId: string, title: string): void {
    const tab = allTabs.value.find((t) => t.tabId === tabId)
    if (tab) {
      tab.title = title
      tab.titleKey = undefined
    }
  }

  /**
   * 更新某个 Tab 的 props（不重建 Tab）。
   * 用于“split 后把拷贝 Tab 改成另一个 profileId”等场景。
   */
  function updateTabProps(tabId: string, propsPatch: Record<string, unknown>): void {
    const tab = allTabs.value.find((t) => t.tabId === tabId)
    if (!tab) {
      return
    }
    Object.assign(tab.props, propsPatch)
  }

  return {
    groups,
    activeGroupId,
    activeGroup,
    activeTab,
    activeTabId,
    allTabs,
    openTab,
    openModule,
    openSettings,
    activateTab,
    setActiveGroup,
    closeTab,
    closeOthers,
    closeToRight,
    closeAll,
    moveTab,
    moveTabToGroup,
    splitGroup,
    closeGroup,
    resizeGroups,
    setDirty,
    updateTitle,
    updateTabProps,
    hydrate,
  }
})
