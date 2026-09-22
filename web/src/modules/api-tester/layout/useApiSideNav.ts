/**
 * API 侧栏：集合树常驻；历史同栏展开；环境配置打开 Shell 单例 Tab。
 */
import { API_ENV_VIEW_ID, getInternalView } from '@/shell/internal-views'
import { useTabStore } from '@/stores/tab'
import { ref } from 'vue'
import { useApiTesterStore } from '../stores/api-tester'

const historyOpen = ref(false)
const historySeen = ref(false)

/** API 侧栏分区开关。模块内单例，右键与分区标题共用。 */
export function useApiSideNav() {
  const api = useApiTesterStore()
  const tabStore = useTabStore()

  /** 打开或聚焦环境配置 Tab（全局单例，对齐设置页）。 */
  function openEnvironments(): void {
    const existing = tabStore.allTabs.find((tab) => tab.moduleId === API_ENV_VIEW_ID)
    if (existing) {
      tabStore.activateTab(existing.tabId)
      return
    }
    const view = getInternalView(API_ENV_VIEW_ID)
    tabStore.openTab({
      moduleId: API_ENV_VIEW_ID,
      titleKey: view?.titleKey ?? 'modules.api.sideEnvironment',
      icon: view?.icon ?? 'globe',
    })
  }

  function revealHistory(): void {
    historySeen.value = true
    historyOpen.value = true
    void api.refreshHistory()
  }

  function toggleHistory(): void {
    if (historyOpen.value) {
      historyOpen.value = false
      return
    }
    revealHistory()
  }

  return { historyOpen, historySeen, openEnvironments, revealHistory, toggleHistory }
}
