import { onBeforeUnmount, ref } from 'vue'
import { subscribeBridgeEventByPrefix } from '@/api'
import type { OracleIoDoneEvent, OracleIoProgressEvent } from '@/api/types/oracle'

export interface OracleIoTaskLine {
  taskId: string
  phase: string
  message: string
  ok?: boolean
  outputPath?: string
  at: number
}

function donePhaseOf(ok: boolean, message: string): string {
  if (ok) return 'done'
  if (message === 'canceled') return 'canceled'
  return 'failed'
}

function progressKind(message: string): string | null {
  if (message.startsWith('wrote ')) return 'wrote'
  if (message.startsWith('exported ')) return 'exported'
  if (message.startsWith('imported ')) return 'imported'
  // 进度行与终态汇总都可能以 executed 开头；汇总含 ", " 时单独成行，避免覆盖错误/跳过明细
  if (message.startsWith('executed ') && !message.includes(', ')) return 'executed'
  if (message.startsWith('progress ')) return 'progress'
  if (message.startsWith('skip statement ')) return 'skip'
  if (message.startsWith('error near ')) return 'error'
  if (message.startsWith('dumped ')) return 'dumped'
  if (message.startsWith('dumping ')) return 'dumping'
  if (message.startsWith('restoring')) return 'restoring'
  if (message.startsWith('running dump')) return 'dumping-run'
  if (message.startsWith('resolving ')) return 'resolving'
  return null
}

const MAX_LOG_LINES = 400
const MAX_LOG_MESSAGE_CHARS = 240
const MAX_EARLY_PROGRESS = 200

function truncateLogMessage(message: string): string {
  if (message.length <= MAX_LOG_MESSAGE_CHARS) return message
  return `${message.slice(0, MAX_LOG_MESSAGE_CHARS)}…`
}

export function useOracleIoTasks(prefix = 'oracle.io.') {
  const activeTaskId = ref<string | null>(null)
  const lastMessage = ref('')
  const lastOutputPath = ref<string | undefined>()
  const lines = ref<OracleIoTaskLine[]>([])
  let offEvent: (() => void) | null = null
  let trackedTaskId: string | null = null
  let acceptingEarly = false
  let resolveDone: ((ev: OracleIoDoneEvent) => void) | null = null
  const earlyDones = new Map<string, OracleIoDoneEvent>()
  /** track() 之后、waitForTask(taskId) 之前到达的 progress，按 taskId 缓存后回放。 */
  const earlyProgress = new Map<string, OracleIoProgressEvent[]>()

  function pushLine(line: Omit<OracleIoTaskLine, 'at'>): void {
    const message = truncateLogMessage(line.message)
    line = { ...line, message }
    if (
      line.ok === undefined &&
      (message === 'queued' || message === 'running' || message === line.phase)
    ) {
      return
    }
    const now = Date.now()
    const prev = lines.value[lines.value.length - 1]
    const prevKind = prev ? progressKind(prev.message) : null
    const nextKind = progressKind(message)
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
    lines.value = [...lines.value.slice(-(MAX_LOG_LINES - 1)), { ...line, at: now }]
  }

  function applyProgress(progress: OracleIoProgressEvent): void {
    if (progress.phase === 'queued' || progress.phase === 'running') {
      activeTaskId.value = progress.taskId
    }
    const message = truncateLogMessage(progress.message ?? progress.phase)
    lastMessage.value = message
    pushLine({ taskId: progress.taskId, phase: progress.phase, message })
  }

  function applyDone(done: OracleIoDoneEvent): void {
    if (activeTaskId.value === done.taskId) {
      activeTaskId.value = null
    }
    const message = done.message ?? (done.ok ? 'completed' : 'failed')
    lastMessage.value = message
    lastOutputPath.value = done.outputPath
    pushLine({
      taskId: done.taskId,
      phase: donePhaseOf(done.ok, message),
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
      const event = detail as OracleIoProgressEvent | OracleIoDoneEvent
      if (event.type.endsWith('.progress')) {
        const progress = event as OracleIoProgressEvent
        if (trackedTaskId) {
          if (progress.taskId !== trackedTaskId) return
          applyProgress(progress)
          return
        }
        // 尚未 waitForTask：缓存 progress，避免转储首条 dumping 等事件被丢掉后长时间无日志。
        if (!acceptingEarly) return
        const list = earlyProgress.get(progress.taskId) ?? []
        if (list.length < MAX_EARLY_PROGRESS) {
          list.push(progress)
          earlyProgress.set(progress.taskId, list)
        }
        return
      }
      if (!event.type.endsWith('.done')) return
      const done = event as OracleIoDoneEvent
      if (trackedTaskId) {
        if (done.taskId !== trackedTaskId) return
        applyDone(done)
        return
      }
      if (!acceptingEarly) return
      earlyDones.set(done.taskId, done)
    })
  }

  function waitForTask(taskId: string): Promise<OracleIoDoneEvent> {
    ensureSubscribed()
    // 先挂 resolve，再消费 early done/progress，避免事件落在二者之间导致 Promise 永不结束、UI 一直「运行中」
    return new Promise((resolve) => {
      acceptingEarly = false
      trackedTaskId = taskId
      activeTaskId.value = taskId
      resolveDone = resolve
      const buffered = earlyProgress.get(taskId)
      if (buffered) {
        earlyProgress.delete(taskId)
        for (const progress of buffered) {
          applyProgress(progress)
        }
      }
      const early = earlyDones.get(taskId)
      if (early) {
        earlyDones.delete(taskId)
        applyDone(early)
      }
    })
  }

  function track(): void {
    ensureSubscribed()
    acceptingEarly = true
    earlyDones.clear()
    earlyProgress.clear()
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
    earlyProgress.clear()
  }

  onBeforeUnmount(() => {
    offEvent?.()
    offEvent = null
    resolveDone = null
    earlyDones.clear()
    earlyProgress.clear()
  })

  return { activeTaskId, lastMessage, lastOutputPath, lines, track, waitForTask, clearLines }
}
