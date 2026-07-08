import { defineStore } from 'pinia'
import { reactive } from 'vue'

/**
 * 跨层级模块会话操作信号。
 * TabBar 发送信号 → 对应 Session 组件监听并执行动作。
 * 使用递增计数（非 boolean）保证同一 profileId 多次触发都能被 watch 到。
 */
export const useSessionActionStore = defineStore('session-actions', () => {
  /** profileId → 重连请求次数（每次 +1 触发 watch） */
  const reconnectSignals = reactive<Record<string, number>>({})

  function requestReconnect(profileId: string): void {
    reconnectSignals[profileId] = (reconnectSignals[profileId] ?? 0) + 1
  }

  return { reconnectSignals, requestReconnect }
})
