import { ref } from 'vue'
import { mongodbApi } from '@/api'

/** 自动补全请求的防抖间隔（毫秒）。 */
const SUGGEST_DEBOUNCE_MS = 120

/**
 * 内置 REPL 命令补全：对当前输入行做防抖查询，丢弃乱序返回的响应。
 */
export function useMongoCommandSuggest(sessionId: () => string | null) {
  const suggestions = ref<string[]>([])
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

  function schedule(input: string, immediate = false): void {
    if (timer) {
      clearTimeout(timer)
    }
    if (!sessionId()) {
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
    const sid = sessionId()
    if (!sid) {
      suggestions.value = []
      return
    }
    const seq = ++requestSeq
    loading.value = true
    try {
      const result = await mongodbApi.commandSuggest({ sessionId: sid, input })
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
