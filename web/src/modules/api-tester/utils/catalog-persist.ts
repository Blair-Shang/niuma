/**
 * 环境 / 变量关系表落盘（nm_api_environment / nm_api_variable）。
 * 只 queue 调用方点名的 scope，不因一个字段变化扫全部环境。
 */
import type { ApiVariableScope as CatalogVariableScope } from '@/api/types/api-catalog'

export const CATALOG_PERSIST_DEBOUNCE_MS = 500

export function catalogScopeKey(scope: CatalogVariableScope, scopeRefId = ''): string {
  return `${scope}:${scopeRefId}`
}

export function parseCatalogScopeKey(key: string): { scope: CatalogVariableScope; scopeRefId: string } {
  const [scope, scopeRefId = ''] = key.split(':') as [CatalogVariableScope, string]
  return { scope, scopeRefId }
}

export interface CatalogPersister {
  queue: (scope: CatalogVariableScope, scopeRefId?: string) => void
  flushNow: () => void
  flushSoon: (delayMs?: number) => void
  cancelTimer: () => void
}

export function createCatalogPersister(opts: {
  canFlush: () => boolean
  flushScope: (scope: CatalogVariableScope, scopeRefId: string) => Promise<void>
  debounceMs?: number
}): CatalogPersister {
  const debounceMs = opts.debounceMs ?? CATALOG_PERSIST_DEBOUNCE_MS
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  function queue(scope: CatalogVariableScope, scopeRefId = ''): void {
    pending.add(catalogScopeKey(scope, scopeRefId))
    flushSoon()
  }

  function flushSoon(delayMs = debounceMs): void {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      flushNow()
    }, delayMs)
  }

  function flushNow(): void {
    if (!opts.canFlush() || pending.size === 0) return
    const scopes = [...pending]
    pending.clear()
    void (async () => {
      for (const key of scopes) {
        const { scope, scopeRefId } = parseCatalogScopeKey(key)
        await opts.flushScope(scope, scopeRefId)
      }
    })()
  }

  function cancelTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  return { queue, flushNow, flushSoon, cancelTimer }
}
