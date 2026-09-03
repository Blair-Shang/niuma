import type { Ref } from 'vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { subscribeBridgeEventByPrefix } from '@/api/event-bus'
import { sftpApi } from '@/api'
import type { SftpTransferEnqueueParams, SftpTransferState, SftpTransferTask } from '@/api/types/sftp'

const ACTIVE_STATES = new Set<SftpTransferState>(['queued', 'running', 'paused'])

/** SFTP 传输队列：事件总线 + 按 sessionId 过滤。 */
export function useSftpTransfer(sessionId: Ref<string | null>) {
  const tasks = ref<SftpTransferTask[]>([])
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let offEvent: (() => void) | null = null

  function belongsToSession(eventSessionId: unknown): boolean {
    if (!sessionId.value) {
      return false
    }
    if (typeof eventSessionId !== 'string' || !eventSessionId) {
      return true
    }
    return eventSessionId === sessionId.value
  }

  function updateTask(taskId: string, patch: Partial<SftpTransferTask>): void {
    const idx = tasks.value.findIndex((t) => t.taskId === taskId)
    if (idx < 0) {
      return
    }
    const next = [...tasks.value]
    next[idx] = { ...next[idx], ...patch }
    tasks.value = next
  }

  function applyEvent(detail: unknown): void {
    if (typeof detail !== 'object' || detail === null) {
      return
    }
    const e = detail as Record<string, unknown>
    if (typeof e.type !== 'string' || !e.type.startsWith('sftp.transfer.')) {
      return
    }
    if (!belongsToSession(e.sessionId)) {
      return
    }
    const taskId = e.taskId
    if (typeof taskId !== 'string' || !taskId) {
      return
    }

    if (e.type === 'sftp.transfer.progress') {
      const speedBps = Number(e.speedBps ?? 0)
      const patch: Partial<SftpTransferTask> = {
        transferred: Number(e.transferred ?? 0),
        total: Number(e.total ?? 0),
      }
      if (speedBps > 0) {
        patch.speedBps = speedBps
      }
      updateTask(taskId, patch)
      return
    }

    if (e.type === 'sftp.transfer.state') {
      updateTask(taskId, {
        state: e.state as SftpTransferState,
        error: typeof e.error === 'string' ? e.error : undefined,
      })
    }
  }

  async function refresh(): Promise<void> {
    if (!sessionId.value) {
      tasks.value = []
      return
    }
    const prev = new Map(tasks.value.map((task) => [task.taskId, task]))
    const result = await sftpApi.transferList({ sessionId: sessionId.value })
    tasks.value = (result.tasks ?? []).map((task) => {
      if (task.speedBps > 0) {
        return task
      }
      const last = prev.get(task.taskId)
      if (last && last.speedBps > 0) {
        return { ...task, speedBps: last.speedBps }
      }
      return task
    })
  }

  function stopPoll(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function startPoll(): void {
    if (pollTimer) {
      return
    }
    pollTimer = setInterval(() => {
      void refresh().then(() => {
        const active = tasks.value.some((t) => ACTIVE_STATES.has(t.state))
        if (!active) {
          stopPoll()
        }
      })
    }, 3000)
  }

  async function enqueue(
    params: Omit<SftpTransferEnqueueParams, 'sessionId'>,
  ): Promise<string> {
    if (!sessionId.value) {
      throw new Error('session not open')
    }
    const result = await sftpApi.transferEnqueue({
      sessionId: sessionId.value,
      ...params,
    })
    await refresh()
    startPoll()
    return result.taskId
  }

  async function cancel(taskId: string): Promise<void> {
    await sftpApi.transferCancel({ taskId })
    await refresh()
  }

  async function pause(taskId: string): Promise<void> {
    await sftpApi.transferPause({ taskId })
  }

  async function resume(taskId: string): Promise<void> {
    await sftpApi.transferResume({ taskId })
  }

  onMounted(() => {
    offEvent = subscribeBridgeEventByPrefix('sftp.transfer.', applyEvent)
  })

  onBeforeUnmount(() => {
    offEvent?.()
    stopPoll()
  })

  return { tasks, refresh, enqueue, cancel, pause, resume, startPoll, stopPoll }
}
