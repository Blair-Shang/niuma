import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isBridgeAvailable, shellApi, windowApi } from '@/api'

/**
 * 无边框窗口 chrome 状态与操作（最小化 / 最大化 / 关闭）。
 * 底层调用 `@/api/window` 与 `@/api/shell`。
 */
export const useWindowChromeStore = defineStore('window-chrome', () => {
  const frameless = ref(false)
  const maximized = ref(false)
  const busy = ref(false)

  const controlsVisible = computed(() => frameless.value && isBridgeAvailable())

  /** 从当前窗口 `shell.window.state` 同步是否显示自绘 chrome */
  async function syncFramelessFromShell(): Promise<void> {
    if (!isBridgeAvailable()) {
      frameless.value = false
      return
    }
    try {
      const state = await windowApi.getState()
      if (state.frameless !== undefined) {
        frameless.value = state.frameless === true
        return
      }
      const info = await shellApi.getInfo()
      frameless.value = info.frameless === true
    } catch {
      frameless.value = false
    }
  }

  /** 刷新当前窗口最大化状态（供 TopBar 按钮图标切换） */
  async function refreshState(): Promise<void> {
    if (!controlsVisible.value) {
      return
    }
    try {
      const state = await windowApi.getState()
      maximized.value = state.maximized === true
    } catch {
      /* offline */
    }
  }

  /** 最小化当前 CEF 窗口 */
  async function minimize(): Promise<void> {
    if (!controlsVisible.value || busy.value) {
      return
    }
    busy.value = true
    try {
      await windowApi.minimize()
    } finally {
      busy.value = false
    }
  }

  /** 最大化与还原之间切换 */
  async function toggleMaximize(): Promise<void> {
    if (!controlsVisible.value || busy.value) {
      return
    }
    busy.value = true
    try {
      if (maximized.value) {
        await windowApi.restore()
      } else {
        await windowApi.maximize()
      }
      await refreshState()
    } finally {
      busy.value = false
    }
  }

  /** 关闭当前 CEF 窗口 */
  async function close(): Promise<void> {
    if (!controlsVisible.value || busy.value) {
      return
    }
    busy.value = true
    try {
      await windowApi.close()
    } finally {
      busy.value = false
    }
  }

  /** 启动时同步 frameless 与窗口状态 */
  async function bootstrap(): Promise<void> {
    await syncFramelessFromShell()
    await refreshState()
  }

  return {
    frameless,
    maximized,
    busy,
    controlsVisible,
    syncFramelessFromShell,
    refreshState,
    minimize,
    toggleMaximize,
    close,
    bootstrap,
  }
})
