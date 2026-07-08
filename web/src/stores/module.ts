import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getModuleNavItems } from '@/extensions/registry/extension-registry'
import type { ModuleNavItem } from '@/extensions/types/module'

export type { ModuleNavItem }

export const useModuleStore = defineStore('module', () => {
  const items = ref<ModuleNavItem[]>(getModuleNavItems())

  /** P2：Platform 加载插件后刷新导航 */
  function refreshNav() {
    items.value = getModuleNavItems()
  }

  const sortedItems = computed(() => [...items.value].sort((a, b) => a.order - b.order))

  return { items: sortedItems, refreshNav }
})
