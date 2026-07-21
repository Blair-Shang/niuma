import type { MonacoCompletionContext, MonacoCompletionSnippet } from '@niuma/ui'
import { ref } from 'vue'
import { mongodbApi } from '@/api'
import type { MongoPipelineSuggestion } from '@/api/types/mongodb'

interface QueryScope {
  sessionId: string | null
  database: string
  collection: string
}

/** 结果缓存：按前缀 + 文本尾部，避免列号变化击穿。 */
const SUGGEST_CACHE_TTL_MS = 12_000

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

function suggestCacheKey(scope: QueryScope, context: MonacoCompletionContext): string {
  const tail = context.text.slice(Math.max(0, context.offset - 96), context.offset)
  return [
    scope.sessionId ?? '',
    scope.database,
    scope.collection,
    context.prefix,
    context.triggerCharacter ?? '',
    tail,
  ].join('\0')
}

/**
 * mongosh 查询补全：统一走 `mongodb.query.suggest`（目录与 Schema 均在服务端维护）。
 */
export function useMongoQuerySuggest(scope: () => QueryScope) {
  const loading = ref(false)
  const cache = new Map<string, SuggestCacheEntry>()
  let inflight = 0
  let warmKey = ''

  /** 预热集合/字段元数据缓存（打开面板或切换库时调用）。 */
  async function warmMetadata(): Promise<void> {
    const { sessionId, database, collection } = scope()
    const db = database.trim()
    const coll = collection.trim()
    if (!sessionId || !db) return
    const key = `${sessionId}\0${db}\0${coll}`
    if (key === warmKey) return
    warmKey = key
    try {
      await mongodbApi.querySuggest({
        sessionId,
        database: db,
        collection: coll,
        text: 'db.',
        line: 1,
        column: 4,
        prefix: '',
        triggerCharacter: '.',
      })
      if (coll) {
        await mongodbApi.querySuggest({
          sessionId,
          database: db,
          collection: coll,
          text: `db.${coll}.find({ "`,
          line: 1,
          column: `db.${coll}.find({ "`.length + 1,
          prefix: '',
          triggerCharacter: '"',
        })
      }
    } catch {
      warmKey = ''
    }
  }

  async function provideCompletions(
    context: MonacoCompletionContext,
  ): Promise<MonacoCompletionSnippet[]> {
    const { sessionId, database, collection } = scope()
    const db = database.trim()
    const coll = collection.trim()
    if (!sessionId || !db) {
      return []
    }

    const scoped: QueryScope = { sessionId, database: db, collection: coll }
    const key = suggestCacheKey(scoped, context)
    const cached = cache.get(key)
    if (cached && Date.now() < cached.expiresAt) {
      return cached.suggestions
    }

    inflight += 1
    loading.value = true
    try {
      const result = await mongodbApi.querySuggest({
        sessionId,
        database: db,
        collection: coll,
        text: context.text,
        line: context.line,
        column: context.column,
        prefix: context.prefix,
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

  return { loading, provideCompletions, warmMetadata }
}
