import type { MonacoCompletionContext, MonacoCompletionSnippet } from '@niuma/ui'
import { ref } from 'vue'
import { mongodbApi } from '@/api'
import type { MongoPipelineSuggestion } from '@/api/types/mongodb'

interface PipelineScope {
  sessionId: string | null
  database: string
  collection: string
}

/** 短缓存：Monaco 可能在同一次补全中重复请求相同光标位置。 */
const SUGGEST_CACHE_TTL_MS = 2_000

interface SuggestCacheEntry {
  suggestions: MonacoCompletionSnippet[]
  expiresAt: number
}

function mapSuggestion(item: MongoPipelineSuggestion): MonacoCompletionSnippet {
  return {
    label: item.label,
    insertText: item.insertText,
    detail: item.detail,
    documentation: item.documentation,
    filterText: item.filterText,
    sortText: item.sortText,
    kind: item.kind,
  }
}

function suggestCacheKey(scope: PipelineScope, context: MonacoCompletionContext): string {
  return [
    scope.sessionId ?? '',
    scope.database,
    scope.collection,
    context.line,
    context.column,
    context.prefix,
    context.triggerCharacter ?? '',
  ].join('\0')
}

/**
 * 聚合管道编辑器补全：将 Monaco 光标上下文转发至 `mongodb.pipeline.suggest`，
 * 由服务端完成 JSON 语法扫描、静态目录与动态 Schema 合并。
 */
export function useMongoPipelineSuggest(scope: () => PipelineScope) {
  const loading = ref(false)
  const cache = new Map<string, SuggestCacheEntry>()
  let inflight = 0

  async function provideCompletions(
    context: MonacoCompletionContext,
  ): Promise<MonacoCompletionSnippet[]> {
    const { sessionId, database, collection } = scope()
    const db = database.trim()
    const coll = collection.trim()
    if (!sessionId || !db || !coll) {
      return []
    }

    const scoped: PipelineScope = { sessionId, database: db, collection: coll }
    const key = suggestCacheKey(scoped, context)
    const cached = cache.get(key)
    if (cached && Date.now() < cached.expiresAt) {
      return cached.suggestions
    }

    inflight += 1
    loading.value = true
    try {
      const result = await mongodbApi.pipelineSuggest({
        sessionId,
        database: db,
        collection: coll,
        text: context.text,
        line: context.line,
        column: context.column,
        prefix: context.prefix || undefined,
        triggerCharacter: context.triggerCharacter,
      })
      const suggestions = result.suggestions.map(mapSuggestion)
      cache.set(key, { suggestions, expiresAt: Date.now() + SUGGEST_CACHE_TTL_MS })
      return suggestions
    } catch {
      return []
    } finally {
      inflight -= 1
      if (inflight <= 0) {
        inflight = 0
        loading.value = false
      }
    }
  }

  return { loading, provideCompletions }
}
