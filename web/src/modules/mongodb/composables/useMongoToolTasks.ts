import { onBeforeUnmount, ref } from 'vue'
import { subscribeBridgeEventByPrefix } from '@/api'
import type { MongoToolsDoneEvent, MongoToolsProgressEvent } from '@/api/types/mongodb'

export interface MongoToolTaskLine {
  taskId: string
  phase: string
  message: string
  ok?: boolean
  outputPath?: string
}

export function useMongoToolTasks() {
  const lines = ref<MongoToolTaskLine[]>([])
  let offEvent: (() => void) | null = null

  function ensureSubscribed(): void {
    if (offEvent) {
      return
    }
    offEvent = subscribeBridgeEventByPrefix('mongodb.tools.', (detail) => {
      if (typeof detail !== 'object' || detail === null) {
        return
      }
      const event = detail as MongoToolsProgressEvent | MongoToolsDoneEvent
      if (event.type === 'mongodb.tools.progress') {
        lines.value = [
          ...lines.value.slice(-199),
          {
            taskId: event.taskId,
            phase: event.phase,
            message: event.message ?? event.phase,
          },
        ]
        return
      }
      if (event.type === 'mongodb.tools.done') {
        lines.value = [
          ...lines.value.slice(-199),
          {
            taskId: event.taskId,
            phase: event.ok ? 'done' : 'failed',
            message: event.message ?? (event.ok ? 'completed' : 'failed'),
            ok: event.ok,
            outputPath: event.outputPath,
          },
        ]
      }
    })
  }

  function track(): void {
    ensureSubscribed()
  }

  function clear(): void {
    lines.value = []
  }

  onBeforeUnmount(() => {
    offEvent?.()
    offEvent = null
  })

  return { lines, track, clear }
}
