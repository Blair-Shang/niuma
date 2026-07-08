import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  categoryForRoute,
  defaultRouteForCategory,
  normalizeActiveCategory,
} from '@/extensions/shell/activity-bar-config'
import type { ModuleCategory } from '@/extensions/types/module'
import { useModuleStore } from '@/stores/module'

/**
 * Shell 布局状态 — VS Code 式 Activity Bar + 可折叠 Primary Side Bar。
 */
export const useShellStore = defineStore('shell', () => {
  const moduleStore = useModuleStore()

  const activeCategory = ref<ModuleCategory>('explorer')
  /** Primary Side Bar 是否展开（再点同一 Activity 图标可收起；RsSplitPane 负责实际宽度） */
  const sidebarVisible = ref(true)
  /**
   * 全局 AI 助手面板是否展开。AI 为跨模块通用能力（非某一领域模块），
   * 以右侧常驻面板形式与当前模块并存——任意模块工作时都可随时唤起。
   */
  const aiPanelOpen = ref(false)
  /** 全局底部 Dock（传输队列等）是否展开 */
  const bottomDockOpen = ref(false)
  /** 底部 Dock 当前 Tab */
  const bottomDockTab = ref<'transfers'>('transfers')
  /** 底部 Dock 高度（px） */
  const bottomDockHeight = ref(220)

  /**
   * 切换 Activity Bar 领域；同项二次点击收起侧栏（VS Code 行为）。
   *
   * @param category - 目标领域
   */
  function selectCategory(category: ModuleCategory): void {
    if (activeCategory.value === category) {
      sidebarVisible.value = !sidebarVisible.value
      return
    }
    activeCategory.value = category
    sidebarVisible.value = true
  }

  /** 展开侧栏 */
  function showSidebar(): void {
    sidebarVisible.value = true
  }

  /** 收起侧栏 */
  function hideSidebar(): void {
    sidebarVisible.value = false
  }

  /**
   * 切换全局 AI 助手面板。
   */
  function toggleAiPanel(): void {
    aiPanelOpen.value = !aiPanelOpen.value
  }

  /**
   * 设置全局 AI 助手面板开合。
   *
   * @param open - 是否展开
   */
  function setAiPanelOpen(open: boolean): void {
    aiPanelOpen.value = open
  }

  function toggleBottomDock(): void {
    bottomDockOpen.value = !bottomDockOpen.value
  }

  function openBottomDock(tab: 'transfers' = 'transfers'): void {
    bottomDockTab.value = tab
    bottomDockOpen.value = true
  }

  function closeBottomDock(): void {
    bottomDockOpen.value = false
  }

  function setBottomDockHeight(height: number): void {
    bottomDockHeight.value = Math.max(120, Math.min(480, height))
  }

  /**
   * 路由变化时同步 Activity Bar 高亮（内置视图 Tab 如设置无模块路由，不影响此处）。
   *
   * @param path - route.path
   */
  function syncFromRoute(path: string): void {
    const cat = categoryForRoute(moduleStore.items, path)
    if (cat) {
      activeCategory.value = cat
      sidebarVisible.value = true
    }
  }

  /**
   * 选中领域后跳转到该领域第一个模块（Activity 点击且当前不在该领域时）。
   *
   * @param category - 目标领域
   * @returns 建议跳转路径；null 表示无需跳转
   */
  function routeAfterCategorySelect(category: ModuleCategory): string | null {
    const route = defaultRouteForCategory(moduleStore.items, category)
    return route
  }

  watch(
    () => moduleStore.items,
    (items) => {
      activeCategory.value = normalizeActiveCategory(items, activeCategory.value)
    },
    { deep: true },
  )

  return {
    activeCategory,
    sidebarVisible,
    aiPanelOpen,
    bottomDockOpen,
    bottomDockTab,
    bottomDockHeight,
    selectCategory,
    showSidebar,
    hideSidebar,
    toggleAiPanel,
    setAiPanelOpen,
    toggleBottomDock,
    openBottomDock,
    closeBottomDock,
    setBottomDockHeight,
    syncFromRoute,
    routeAfterCategorySelect,
  }
})
