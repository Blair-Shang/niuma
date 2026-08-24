import { onBeforeUnmount, ref } from 'vue'
import { subscribeBridgeEventByPrefix } from '@/api'
import type { PostgresIoDoneEvent, PostgresIoProgressEvent } from '@/api/types/postgres'

export interface PostgresIoTaskLine {
  taskId: string
  phase: string
  message: string
  ok?: boolean
  outputPath?: string
  at: number
}

function donePhase(ok: boolean, message: string): string {
  if (ok) return 'done'
  if (message === 'canceled') return 'canceled'
  return 'failed'
}

function progressKind(message: string): string | null {
  if (message.startsWith('wrote ')) return 'wrote'
  if (message.startsWith('exported ')) return 'exported'
  if (message.startsWith('imported ')) return 'imported'
  if (message.startsWith('executed ')) return 'executed'
  return null
}

/**
 * 单浮窗实例的任务进度订阅。
 * 仅处理当前 trackedTaskId，避免多窗并发时日志串线。
 */
export function usePostgresIoTasks(prefix = 'postgres.io.') {
  const activeTaskId = ref<string | null>(null)
  const lastMessage = ref('')
  const lastOutputPath = ref<string | undefined>()
  const lines = ref<PostgresIoTaskLine[]>([])
  let offEvent: (() => void) | null = null
  let trackedTaskId: string | null = null
  /** track() 之后、waitForTask 之前短暂为 true */
  let acceptingEarly = false
  let resolveDone: ((ev: PostgresIoDoneEvent) => void) | null = null
  const earlyDones = new Map<string, PostgresIoDoneEvent>()

  function pushLine(line: Omit<PostgresIoTaskLine, 'at'>): void {
    // 跳过无信息的 queued/running 心跳行（顶部已有「任务进行中」）
    if (
      line.ok === undefined &&
      (line.message === 'queued' ||
        line.message === 'running' ||
        line.message === line.phase)
    ) {
      return
    }
    const now = Date.now()
    const prev = lines.value[lines.value.length - 1]
    const prevKind = prev ? progressKind(prev.message) : null
    const nextKind = progressKind(line.message)
    // 仅合并字节/语句计数类进度；dumping schema.table 等关键节点始终追加
    if (
      prev?.taskId === line.taskId &&
      prevKind &&
      prevKind === nextKind &&
      prev.ok === undefined &&
      line.ok === undefined
    ) {
      const next = lines.value.slice()
      next[next.length - 1] = { ...line, at: now }
      lines.value = next
      return
    }
    // 连续 dumping 行原地更新，避免刷满屏；保留上一张表名的可读进度
    if (
      prev?.taskId === line.taskId &&
      prev.ok === undefined &&
      line.ok === undefined &&
      prev.message.startsWith('dumping ') &&
      line.message.startsWith('dumping ')
    ) {
      const next = lines.value.slice()
      next[next.length - 1] = { ...line, at: now }
      lines.value = next
      return
    }
    lines.value = [...lines.value.slice(-199), { ...line, at: now }]
  }

  function applyDone(done: PostgresIoDoneEvent): void {
    if (activeTaskId.value === done.taskId) {
      activeTaskId.value = null
    }
    const message = done.message ?? (done.ok ? 'completed' : 'failed')
    lastMessage.value = message
    lastOutputPath.value = done.outputPath
    pushLine({
      taskId: done.taskId,
      phase: donePhase(done.ok, message),
      message,
      ok: done.ok,
      outputPath: done.outputPath,
    })
    if (resolveDone) {
      resolveDone(done)
      resolveDone = null
    }
  }

  function ensureSubscribed(): void {
    if (offEvent) return
    offEvent = subscribeBridgeEventByPrefix(prefix, (detail) => {
      if (typeof detail !== 'object' || detail === null) return
      const event = detail as PostgresIoProgressEvent | PostgresIoDoneEvent
      if (event.type.endsWith('.progress')) {
        const progress = event as PostgresIoProgressEvent
        if (!trackedTaskId || progress.taskId !== trackedTaskId) return
        if (progress.phase === 'queued' || progress.phase === 'running') {
          activeTaskId.value = progress.taskId
        }
        const message = progress.message ?? progress.phase
        lastMessage.value = message
        pushLine({
          taskId: progress.taskId,
          phase: progress.phase,
          message,
        })
        return
      }
      if (!event.type.endsWith('.done')) return
      const done = event as PostgresIoDoneEvent
      if (trackedTaskId) {
        if (done.taskId !== trackedTaskId) return
        applyDone(done)
        return
      }
      if (!acceptingEarly) return
      earlyDones.set(done.taskId, done)
    })
  }

  function waitForTask(taskId: string): Promise<PostgresIoDoneEvent> {
    ensureSubscribed()
    acceptingEarly = false
    trackedTaskId = taskId
    activeTaskId.value = taskId
    const early = earlyDones.get(taskId)
    if (early) {
      earlyDones.delete(taskId)
      applyDone(early)
      return Promise.resolve(early)
    }
    return new Promise((resolve) => {
      resolveDone = resolve
    })
  }

  function track(): void {
    ensureSubscribed()
    acceptingEarly = true
    earlyDones.clear()
  }

  function clearLines(): void {
    lines.value = []
    lastMessage.value = ''
    lastOutputPath.value = undefined
    trackedTaskId = null
    activeTaskId.value = null
    acceptingEarly = false
    resolveDone = null
    earlyDones.clear()
  }

  onBeforeUnmount(() => {
    offEvent?.()
    offEvent = null
    resolveDone = null
    earlyDones.clear()
  })

  return {
    activeTaskId,
    lastMessage,
    lastOutputPath,
    lines,
    track,
    waitForTask,
    clearLines,
  }
}
