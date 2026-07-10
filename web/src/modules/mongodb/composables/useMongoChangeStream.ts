import { inject, onBeforeUnmount, ref } from 'vue'
import { mongodbApi, subscribeBridgeEventByPrefix } from '@/api'
import type { MongoMonitorEvent } from '@/api/types/mongodb'
import { SESSION_RELEASE_CLEANUP_KEY } from '@/modules/connection/session-release'

export type MongoChangeStreamState = 'idle' | 'starting' | 'ready' | 'closed'

interface StartParams {
  sessionId: string
  database: string
  collection: string
  pipeline?: unknown[]
}

export function useMongoChangeStream() {
  const streamId = ref<string | null>(null)
  const state = ref<MongoChangeStreamState>('idle')
  let offEvent: (() => void) | null = null

  function ensureSubscribed(onEvent: (event: MongoMonitorEvent) => void): void {
    if (offEvent) {
      return
    }
    offEvent = subscribeBridgeEventByPrefix('mongodb.monitor.', (detail) => {
      if (typeof detail !== 'object' || detail === null) {
        return
      }
      const event = detail as MongoMonitorEvent
      if (event.type !== 'mongodb.monitor.event' || !streamId.value || event.streamId !== streamId.value) {
        return
      }
      onEvent(event)
    })
  }

  async function start(params: StartParams, onEvent: (event: MongoMonitorEvent) => void): Promise<void> {
    if (streamId.value) {
      return
    }
    ensureSubscribed(onEvent)
    state.value = 'starting'
    const result = await mongodbApi.monitorStreamStart(params)
    streamId.value = result.streamId
    state.value = 'ready'
  }

  async function stop(): Promise<void> {
    const current = streamId.value
    streamId.value = null
    state.value = 'closed'
    if (!current) {
      return
    }
    try {
      await mongodbApi.monitorStreamStop({ streamId: current })
    } catch {
      // session 关闭时流可能已被回收
    }
  }

  const registerReleaseCleanup = inject(SESSION_RELEASE_CLEANUP_KEY, null)
  registerReleaseCleanup?.(() => stop())

  onBeforeUnmount(() => {
    offEvent?.()
    offEvent = null
    void stop()
  })

  return { streamId, state, start, stop }
}
