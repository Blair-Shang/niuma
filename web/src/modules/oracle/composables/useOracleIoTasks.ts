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
  if (message.startsWith('dumped ')) return 'dumped'
  if (message.startsWith('restoring')) return 'restoring'
  if (message.startsWith('running dump')) return 'dumping-run'
  return null
}

const MAX_LOG_LINES = 400
const MAX_LOG_MESSAGE_CHARS = 240

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
    if (
      prev?.taskId === line.taskId &&
      prev.ok === undefined &&
      line.ok === undefined &&
      prev.message.startsWith('dumping ') &&
      message.startsWith('dumping ')
    ) {
      const next = lines.value.slice()
      next[next.length - 1] = { ...line, at: now }
      lines.value = next
      return
    }
    lines.value = [...lines.value.slice(-(MAX_LOG_LINES - 1)), { ...line, at: now }]
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
      const event = detail as OracleIoProgressEvent | OracleIoDoneEvent
      if (event.type.endsWith('.progress')) {
        const progress = event as OracleIoProgressEvent
        if (!trackedTaskId || progress.taskId !== trackedTaskId) return
        if (progress.phase === 'queued' || progress.phase === 'running') {
          activeTaskId.value = progress.taskId
        }
        const message = truncateLogMessage(progress.message ?? progress.phase)
        lastMessage.value = message
        pushLine({ taskId: progress.taskId, phase: progress.phase, message })
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

  return { activeTaskId, lastMessage, lastOutputPath, lines, track, waitForTask, clearLines }
}
