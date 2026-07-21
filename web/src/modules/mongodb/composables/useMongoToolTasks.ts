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
  /** 当前未结束的工具任务；用于停止按钮与互斥启动 */
  const activeTaskId = ref<string | null>(null)
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
        if (event.phase === 'queued' || event.phase === 'running') {
          activeTaskId.value = event.taskId
        }
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
        if (activeTaskId.value === event.taskId) {
          activeTaskId.value = null
        }
        lines.value = [
          ...lines.value.slice(-199),
          {
            taskId: event.taskId,
            phase: event.ok ? 'done' : event.message === 'canceled' ? 'canceled' : 'failed',
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

  function trackTask(taskId: string): void {
    ensureSubscribed()
    activeTaskId.value = taskId
  }

  function clear(): void {
    lines.value = []
  }

  onBeforeUnmount(() => {
    offEvent?.()
    offEvent = null
  })

  return { lines, activeTaskId, track, trackTask, clear }
}
