/**
 * L4 会话借用 — **运维 *Session.vue 的唯一入口**。
 *
 * 封装 `session-registry.acquire` / `forceReconnect`，供各协议 Session 在 onMounted 时调用。
 * Tab 关闭断线由 `tabStore.close*` → `registry.release` 完成，**禁止**在本组件或
 * `onBeforeUnmount` 中直接 `*Api.sessionClose`。
 *
 * ## 用法
 *
 * ```ts
 * const { sessionId, acquireSession, reconnectSession } = useSessionLease({
 *   kind: 'redis',
 *   profileId: () => props.profileId,
 *   tabId: () => props.tabId,           // ModuleWorkspace 注入，必填
 *   database: () => scopeDatabase.value, // Redis scoped key
 *   onAcquired: async (sid) => { ... },
 *   buildOnRelease: () => [() => transferHub.unregisterSession(sid)],
 * })
 * onMounted(() => void acquireSession())
 * ```
 *
 * 子 Pane 可通过 inject `SESSION_RELEASE_CLEANUP_KEY` 注册 release 清理（停流等）。
 *
 * @see docs/21-session-registry.md §0.5–§0.6
 * @see web/src/stores/session-registry.ts
 */
import { provide, ref, type Ref } from 'vue'
import type { ConnKind } from '@/modules/ops/types'
import { SESSION_RELEASE_CLEANUP_KEY, type SessionReleaseCleanup } from '@/modules/connection/session-release'
import { useSessionRegistry } from '@/stores/session-registry'
import type { AcquireOpts } from '@/modules/connection/session-policy'

export interface UseSessionLeaseOptions {
  kind: ConnKind
  profileId: () => string
  tabId: () => string | undefined
  database?: () => number | undefined
  /** acquire / forceReconnect 成功后 */
  onAcquired?: (sessionId: string, isNew: boolean) => void | Promise<void>
  /** 每次 release 时除子组件注册外的额外清理 */
  buildOnRelease?: () => SessionReleaseCleanup[]
}

export function useSessionLease(options: UseSessionLeaseOptions): {
  sessionId: Ref<string | null>
  acquireSession: () => Promise<void>
  reconnectSession: () => Promise<void>
  registerReleaseCleanup: (fn: SessionReleaseCleanup) => void
} {
  const registry = useSessionRegistry()
  const sessionId = ref<string | null>(null)
  const extraCleanups: SessionReleaseCleanup[] = []

  function registerReleaseCleanup(fn: SessionReleaseCleanup): void {
    extraCleanups.push(fn)
  }

  provide(SESSION_RELEASE_CLEANUP_KEY, registerReleaseCleanup)

  function buildAcquireOpts(): AcquireOpts {
    const tabId = options.tabId()
    if (!tabId) {
      throw new Error('tabId is required for session lease')
    }
    return {
      kind: options.kind,
      profileId: options.profileId(),
      tabId,
      database: options.database?.(),
    }
  }

  function buildOnRelease(): SessionReleaseCleanup {
    return async () => {
      const fns = [...(options.buildOnRelease?.() ?? []), ...extraCleanups]
      await Promise.all(fns.map((fn) => fn()))
    }
  }

  async function acquireSession(): Promise<void> {
    const result = await registry.acquire(buildAcquireOpts(), { onRelease: buildOnRelease() })
    sessionId.value = result.sessionId
    await options.onAcquired?.(result.sessionId, result.isNew)
  }

  async function reconnectSession(): Promise<void> {
    const result = await registry.forceReconnect(buildAcquireOpts(), { onRelease: buildOnRelease() })
    sessionId.value = result.sessionId
    await options.onAcquired?.(result.sessionId, true)
  }

  return { sessionId, acquireSession, reconnectSession, registerReleaseCleanup }
}
