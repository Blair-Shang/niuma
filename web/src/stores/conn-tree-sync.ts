import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 连接树聚焦请求（Tab / 会话 → 侧栏树高亮）。
 * 使用 tick 递增，保证同一 resourceKey 重复请求也能触发 watch。
 *
 * 对象子树失效请用 `invalidateConnTreeChildren`（useConnTreeChildren 单例缓存），
 * 不要把协议 DDL 逻辑接到 OpsConnectionPanel。
 */
export const useConnTreeSyncStore = defineStore('conn-tree-sync', () => {
  const focusKey = ref<string | null>(null)
  const tick = ref(0)

  function requestFocus(resourceKey: string): void {
    focusKey.value = resourceKey
    tick.value += 1
  }

  function clearFocus(): void {
    focusKey.value = null
  }

  return {
    focusKey,
    tick,
    requestFocus,
    clearFocus,
  }
})
