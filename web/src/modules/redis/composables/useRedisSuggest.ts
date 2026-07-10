import { ref } from 'vue'
import { redisApi } from '@/api'
import type { RedisCommandSuggestion } from '@/api/types/redis'

/** 自动补全请求的防抖间隔（毫秒）：太短会在快速打字时打爆 IPC，太长则显得卡顿。 */
const SUGGEST_DEBOUNCE_MS = 120

/**
 * 命令自动补全：对当前输入做防抖查询，并丢弃过期（乱序返回）的响应。
 *
 * 两种返回形态（与后端 `suggest_generic` 对齐）：
 * - 命令名/子命令名前缀尚未敲完：`suggestions` 为多条候选，可下拉选择。
 * - 命令名（含子命令）已敲完：`suggestions` 为单条，附带 `remainingArguments` 收窄提示，
 *   仅作展示用，不构成可选择的候选列表。
 */
export function useRedisSuggest(sessionId: () => string | null) {
  const suggestions = ref<RedisCommandSuggestion[]>([])
  const loading = ref(false)

  let timer: ReturnType<typeof setTimeout> | undefined
  let requestSeq = 0

  function clear(): void {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    suggestions.value = []
  }

  /**
   * @param immediate 跳过防抖立即查询；用于 Tab 补全后需要马上刷新候选列表的场景，
   * 避免用户连续按 Tab 时感觉到明显的响应延迟。
   */
  function schedule(input: string, immediate = false): void {
    if (timer) {
      clearTimeout(timer)
    }
    if (!input.trim()) {
      suggestions.value = []
      return
    }
    if (immediate) {
      void fetchNow(input)
      return
    }
    timer = setTimeout(() => {
      void fetchNow(input)
    }, SUGGEST_DEBOUNCE_MS)
  }

  async function fetchNow(input: string): Promise<void> {
    const seq = ++requestSeq
    loading.value = true
    try {
      const result = await redisApi.commandSuggest({
        input,
        sessionId: sessionId() ?? undefined,
      })
      if (seq === requestSeq) {
        suggestions.value = result.suggestions
      }
    } catch {
      if (seq === requestSeq) {
        suggestions.value = []
      }
    } finally {
      if (seq === requestSeq) {
        loading.value = false
      }
    }
  }

  return { suggestions, loading, schedule, clear }
}
