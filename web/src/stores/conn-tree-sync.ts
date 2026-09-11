import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ConnItem, ConnKind } from '@/modules/ops/types'

/**
 * 连接树聚焦请求（Tab / 会话 → 侧栏树高亮）。
 * 使用 tick 递增，保证同一 resourceKey 重复请求也能触发 watch。
 *
 * 对象子树失效请用 `invalidateConnTreeChildren`（useConnTreeChildren 单例缓存），
 * 不要把协议 DDL 逻辑接到 OpsConnectionPanel。
 *
 * 工作区空态通过 requestCreate / requestImport 复用侧栏已挂载的表单；
 * profiles 是侧栏 list 的只读快照，空态禁止再打 connection.list。
 */
export const useConnTreeSyncStore = defineStore('conn-tree-sync', () => {
  const focusKey = ref<string | null>(null)
  const tick = ref(0)
  const createKind = ref<ConnKind | null>(null)
  const createTick = ref(0)
  const importTick = ref(0)
  const profiles = ref<ConnItem[]>([])

  function requestFocus(resourceKey: string): void {
    focusKey.value = resourceKey
    tick.value += 1
  }

  function clearFocus(): void {
    focusKey.value = null
  }

  function requestCreate(kind: ConnKind): void {
    createKind.value = kind
    createTick.value += 1
  }

  function requestImport(): void {
    importTick.value += 1
  }

  function setProfiles(items: ConnItem[]): void {
    profiles.value = items
  }

  return {
    focusKey,
    tick,
    createKind,
    createTick,
    importTick,
    profiles,
    requestFocus,
    clearFocus,
    requestCreate,
    requestImport,
    setProfiles,
  }
})
