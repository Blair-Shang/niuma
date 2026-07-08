import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isBridgeAvailable, shellApi } from '@/api'
import type { ShellInfo } from '@/api/types/shell'

/** Web 运行时与 Shell 的连接模式 */
export type RuntimeMode = 'cef' | 'offline'

/** @deprecated 请使用 `@/api/types` 中的 `ShellInfo` */
export type { ShellInfo }

/**
 * Shell Bridge 连接状态与元信息。
 * 业务请求应通过 `@/api`，本 store 仅维护 UI 所需连接态。
 */
export const useBridgeStore = defineStore('bridge', () => {
  const connected = ref(false)
  const runtimeMode = ref<RuntimeMode>('offline')
  const shellVersion = ref<string | null>(null)
  const shellInfo = ref<ShellInfo | null>(null)

  const statusLabel = computed(() => {
    if (!connected.value) return 'Offline'
    return runtimeMode.value === 'cef' ? 'CEF Shell' : 'Shell'
  })

  /** 探测 Bridge 并更新 `connected` / `runtimeMode` */
  async function ping() {
    try {
      await shellApi.ping()
      connected.value = true
      runtimeMode.value = isBridgeAvailable() ? 'cef' : 'offline'
    } catch {
      connected.value = false
      runtimeMode.value = 'offline'
    }
  }

  /**
   * 拉取 Shell 版本与环境信息。
   *
   * @remarks 仅在 `connected === true` 时执行
   */
  async function loadShellMeta() {
    if (!connected.value) return
    try {
      const version = await shellApi.getVersion()
      shellVersion.value = version.version
      shellInfo.value = await shellApi.getInfo()
    } catch {
      shellVersion.value = null
      shellInfo.value = null
    }
  }

  /** 初始化连接态：先 ping，再加载元信息 */
  async function bootstrap() {
    await ping()
    await loadShellMeta()
  }

  return {
    connected,
    runtimeMode,
    shellVersion,
    shellInfo,
    statusLabel,
    ping,
    bootstrap,
    loadShellMeta,
  }
})
