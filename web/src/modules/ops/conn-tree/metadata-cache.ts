const DEFAULT_TTL_MS = 15_000

interface CacheEntry<T> {
  expiresAt: number
  value: T
}

/**
 * 连接树元数据内存缓存：TTL + 并发 in-flight 去重。
 * 键由调用方构造（如 `redis:db-list:{profileId}`）。
 */
export class ConnMetadataCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>()
  private readonly inflight = new Map<string, Promise<unknown>>()

  async fetch<T>(key: string, loader: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
    const now = Date.now()
    const hit = this.entries.get(key)
    if (hit && hit.expiresAt > now) {
      return hit.value as T
    }

    const pending = this.inflight.get(key)
    if (pending) {
      return pending as Promise<T>
    }

    const task = loader()
      .then((value) => {
        this.entries.set(key, { value, expiresAt: Date.now() + ttlMs })
        return value
      })
      .finally(() => {
        this.inflight.delete(key)
      })

    this.inflight.set(key, task)
    return task
  }

  invalidate(prefix?: string): void {
    if (!prefix) {
      this.entries.clear()
      return
    }
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key)
      }
    }
  }
}

export const connMetadataCache = new ConnMetadataCache()
