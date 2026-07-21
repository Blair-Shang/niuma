/**
 * 会话级 Catalog 短缓存（docs/23）：按请求 key + TTL，不做磁盘持久化。
 */
import type {
  CatalogColumnsResult,
  CatalogSchemasResult,
  CatalogTablesResult,
} from './types'

const TTL_MS = 45_000

type Entry<T> = { value: T; expiresAt: number }

const schemaCache = new Map<string, Entry<CatalogSchemasResult>>()
const tableCache = new Map<string, Entry<CatalogTablesResult>>()
const columnCache = new Map<string, Entry<CatalogColumnsResult>>()
const inflight = new Map<string, Promise<unknown>>()

function readCache<T>(map: Map<string, Entry<T>>, key: string): T | null {
  const hit = map.get(key)
  if (!hit) return null
  if (Date.now() >= hit.expiresAt) {
    map.delete(key)
    return null
  }
  return hit.value
}

function writeCache<T>(map: Map<string, Entry<T>>, key: string, value: T): T {
  map.set(key, { value, expiresAt: Date.now() + TTL_MS })
  return value
}

async function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing !== undefined) return existing
  const p = run().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key)
  })
  inflight.set(key, p)
  return p
}

export function cachedSchemas(
  key: string,
  run: () => Promise<CatalogSchemasResult>,
): Promise<CatalogSchemasResult> {
  const hit = readCache(schemaCache, key)
  if (hit) return Promise.resolve(hit)
  return once(key, async () => writeCache(schemaCache, key, await run()))
}

export function cachedTables(
  key: string,
  run: () => Promise<CatalogTablesResult>,
): Promise<CatalogTablesResult> {
  const hit = readCache(tableCache, key)
  if (hit) return Promise.resolve(hit)
  return once(key, async () => writeCache(tableCache, key, await run()))
}

export function cachedColumns(
  key: string,
  run: () => Promise<CatalogColumnsResult>,
): Promise<CatalogColumnsResult> {
  const hit = readCache(columnCache, key)
  if (hit) return Promise.resolve(hit)
  return once(key, async () => writeCache(columnCache, key, await run()))
}

/** 手动刷新元数据时清空（对齐 DBeaver Refresh）。 */
export function clearCatalogCache(): void {
  schemaCache.clear()
  tableCache.clear()
  columnCache.clear()
  inflight.clear()
}
