import { onBeforeUnmount, ref } from 'vue'
import { subscribeBridgeEventByPrefix } from '@/api'
import type { ClickHouseIoDoneEvent, ClickHouseIoProgressEvent } from '@/api/types/clickhouse'

export interface ClickHouseIoTaskLine {
  taskId: string
  phase: string
  message: string
  ok?: boolean
  outputPath?: string
  at: number
}

const MAX_LOG_LINES = 400
const MAX_LOG_MESSAGE_CHARS = 320

function donePhase(ok: boolean, message: string): string {
  if (ok) return 'done'
  return message === 'canceled' ? 'canceled' : 'failed'
}

function truncateLogMessage(message: string): string {
  const limit = message.startsWith('error ') ? 480 : MAX_LOG_MESSAGE_CHARS
  return message.length <= limit ? message : `${message.slice(0, limit)}…`
}

/** 仅合并可替换的进度行，保留 error / completed 等明细 */
function isReplaceableProgress(message: string): boolean {
  return (
    message.startsWith('executed ')
    || message.startsWith('wrote ')
    || message.startsWith('dumped ')
    || message.startsWith('dumping ')
    || message === 'running'
    || message === 'queued'
  )
}

export function useClickHouseIoTasks(prefix = 'clickhouse.io.') {
  const activeTaskId = ref<string | null>(null)
  const lastMessage = ref('')
  const lastOutputPath = ref<string | undefined>()
  const lines = ref<ClickHouseIoTaskLine[]>([])
  let offEvent: (() => void) | null = null
  let trackedTaskId: string | null = null
  let acceptingEarly = false
  let resolveDone: ((ev: ClickHouseIoDoneEvent) => void) | null = null
  const earlyDones = new Map<string, ClickHouseIoDoneEvent>()

  function pushLine(line: Omit<ClickHouseIoTaskLine, 'at'>): void {
    const message = truncateLogMessage(line.message)
    if (line.ok === undefined && (message === 'queued' || message === 'running' || message === line.phase)) return
    const now = Date.now()
    const previous = lines.value.at(-1)
    if (
      previous?.taskId === line.taskId
      && previous.ok === undefined
      && line.ok === undefined
      && previous.phase === line.phase
      && isReplaceableProgress(previous.message)
      && isReplaceableProgress(message)
    ) {
      lines.value = [...lines.value.slice(0, -1), { ...line, message, at: now }]
      return
    }
    lines.value = [...lines.value.slice(-(MAX_LOG_LINES - 1)), { ...line, message, at: now }]
  }

  function applyDone(done: ClickHouseIoDoneEvent): void {
    if (activeTaskId.value === done.taskId) activeTaskId.value = null
    const message = done.message ?? (done.ok ? 'completed' : 'failed')
    lastMessage.value = message
    lastOutputPath.value = done.outputPath
    pushLine({ taskId: done.taskId, phase: donePhase(done.ok, message), message, ok: done.ok, outputPath: done.outputPath })
    resolveDone?.(done)
    resolveDone = null
  }

  function ensureSubscribed(): void {
    if (offEvent) return
    offEvent = subscribeBridgeEventByPrefix(prefix, (detail) => {
      if (typeof detail !== 'object' || detail === null) return
      const event = detail as ClickHouseIoProgressEvent | ClickHouseIoDoneEvent
      if (event.type.endsWith('.progress')) {
        const progress = event as ClickHouseIoProgressEvent
        if (!trackedTaskId || progress.taskId !== trackedTaskId) return
        if (progress.phase === 'queued' || progress.phase === 'running') activeTaskId.value = progress.taskId
        const message = truncateLogMessage(progress.message ?? progress.phase)
        lastMessage.value = message
        pushLine({ taskId: progress.taskId, phase: progress.phase, message })
        return
      }
      if (!event.type.endsWith('.done')) return
      const done = event as ClickHouseIoDoneEvent
      if (trackedTaskId) {
        if (done.taskId === trackedTaskId) applyDone(done)
      } else if (acceptingEarly) {
        earlyDones.set(done.taskId, done)
      }
    })
  }

  function track(): void {
    ensureSubscribed()
    acceptingEarly = true
    earlyDones.clear()
  }

  function waitForTask(taskId: string): Promise<ClickHouseIoDoneEvent> {
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
    return new Promise((resolve) => { resolveDone = resolve })
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
    resolveDone = null
    earlyDones.clear()
  })

  return { activeTaskId, lastMessage, lastOutputPath, lines, track, waitForTask, clearLines }
}
