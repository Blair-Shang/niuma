import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 命令面板可见性与快捷键状态。
 */
export const useCommandPaletteStore = defineStore('commandPalette', () => {
  const open = ref(false)

  /** 打开命令面板 */
  function show(): void {
    open.value = true
  }

  /** 关闭命令面板 */
  function hide(): void {
    open.value = false
  }

  /** 切换命令面板 */
  function toggle(): void {
    open.value = !open.value
  }

  return { open, show, hide, toggle }
})
