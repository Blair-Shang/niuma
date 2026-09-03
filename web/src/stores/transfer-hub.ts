import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { subscribeBridgeEventByPrefix } from '@/api/event-bus'
import { ftpApi, sftpApi } from '@/api'
import type { FtpTransferState, FtpTransferTask } from '@/api/types/ftp'

const ACTIVE_STATES = new Set<FtpTransferState>(['queued', 'running', 'paused'])

export type TransferProvider = 'ftp' | 'ssh' | 'sftp'

export interface HubTransferTask extends FtpTransferTask {
  provider: TransferProvider
}

export interface TransferSessionMeta {
  sessionId: string
  provider: TransferProvider
  label: string
}

function taskSortOrder(state: FtpTransferState): number {
  if (state === 'running') {
    return 0
  }
  if (state === 'queued') {
    return 1
  }
  if (state === 'paused') {
    return 2
  }
  if (state === 'failed') {
    return 3
  }
  return 4
}

/** 全局传输队列：聚合 FTP / SSH 会话任务，供底部 Dock 与 StatusBar 使用。 */
export const useTransferHubStore = defineStore('transfer-hub', () => {
  const tasksById = ref(new Map<string, HubTransferTask>())
  const sessions = ref(new Map<string, TransferSessionMeta>())

  const tasks = computed((): HubTransferTask[] =>
    [...tasksById.value.values()].sort((a, b) => {
      const order = taskSortOrder(a.state) - taskSortOrder(b.state)
      if (order !== 0) {
        return order
      }
      return a.taskId.localeCompare(b.taskId)
    }),
  )

  const activeCount = computed(
    () => tasks.value.filter((task) => ACTIVE_STATES.has(task.state)).length,
  )

  const hasActiveTransfers = computed(() => activeCount.value > 0)

  function providerForSession(sessionId: string): TransferProvider {
    return sessions.value.get(sessionId)?.provider ?? 'ftp'
  }

  function upsertTask(task: HubTransferTask): void {
    const next = new Map(tasksById.value)
    next.set(task.taskId, task)
    tasksById.value = next
  }

  function patchTask(taskId: string, patch: Partial<HubTransferTask>): void {
    const current = tasksById.value.get(taskId)
    if (!current) {
      return
    }
    upsertTask({ ...current, ...patch })
  }

  function applyEvent(detail: unknown): void {
    if (typeof detail !== 'object' || detail === null) {
      return
    }
    const event = detail as Record<string, unknown>
    const type = event.type
    if (typeof type !== 'string') {
      return
    }

    let provider: TransferProvider | null = null
    if (type.startsWith('ftp.transfer.')) {
      provider = 'ftp'
    } else if (type.startsWith('ssh.transfer.')) {
      provider = 'ssh'
    } else if (type.startsWith('sftp.transfer.')) {
      provider = 'sftp'
    } else {
      return
    }

    const taskId = event.taskId
    if (typeof taskId !== 'string' || !taskId) {
      return
    }

    const sessionId = typeof event.sessionId === 'string' ? event.sessionId : ''

    if (type.endsWith('.progress')) {
      const speedBps = Number(event.speedBps ?? 0)
      const patch: Partial<HubTransferTask> = {
        provider,
        sessionId,
        transferred: Number(event.transferred ?? 0),
        total: Number(event.total ?? 0),
      }
      if (speedBps > 0) {
        patch.speedBps = speedBps
      }
      const existing = tasksById.value.get(taskId)
      if (existing) {
        patchTask(taskId, patch)
      }
      return
    }

    if (type.endsWith('.state')) {
      const existing = tasksById.value.get(taskId)
      upsertTask({
        taskId,
        provider,
        sessionId: sessionId || existing?.sessionId || '',
        direction: (existing?.direction ?? event.direction ?? 'download') as HubTransferTask['direction'],
        localPath: existing?.localPath ?? (typeof event.localPath === 'string' ? event.localPath : ''),
        remotePath: existing?.remotePath ?? (typeof event.remotePath === 'string' ? event.remotePath : ''),
        total: existing?.total ?? Number(event.total ?? 0),
        transferred: existing?.transferred ?? Number(event.transferred ?? 0),
        speedBps: existing?.speedBps ?? Number(event.speedBps ?? 0),
        state: event.state as FtpTransferState,
        error: typeof event.error === 'string' && event.error ? event.error : undefined,
      })
    }
  }

  function registerSession(meta: TransferSessionMeta): void {
    const next = new Map(sessions.value)
    next.set(meta.sessionId, meta)
    sessions.value = next
  }

  function unregisterSession(sessionId: string): void {
    if (!sessions.value.has(sessionId)) {
      return
    }
    const next = new Map(sessions.value)
    next.delete(sessionId)
    sessions.value = next
  }

  async function refreshSession(sessionId: string): Promise<void> {
    const meta = sessions.value.get(sessionId)
    if (!meta) {
      return
    }
    const prev = new Map(tasksById.value)
    if (meta.provider === 'ftp') {
      const result = await ftpApi.transferList({ sessionId })
      for (const task of result.tasks ?? []) {
        const last = prev.get(task.taskId)
        prev.set(task.taskId, {
          ...task,
          provider: 'ftp',
          speedBps: task.speedBps > 0 ? task.speedBps : (last?.speedBps ?? 0),
        })
      }
    } else if (meta.provider === 'sftp') {
      const result = await sftpApi.transferList({ sessionId })
      for (const task of result.tasks ?? []) {
        const last = prev.get(task.taskId)
        prev.set(task.taskId, {
          ...task,
          provider: 'sftp',
          speedBps: task.speedBps > 0 ? task.speedBps : (last?.speedBps ?? 0),
        })
      }
    } else {
      const { sshApi } = await import('@/api/ssh')
      const result = await sshApi.transferList({ sessionId })
      for (const task of result.tasks ?? []) {
        const last = prev.get(task.taskId)
        prev.set(task.taskId, {
          ...task,
          provider: 'ssh',
          speedBps: task.speedBps > 0 ? task.speedBps : (last?.speedBps ?? 0),
        })
      }
    }
    tasksById.value = prev
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([...sessions.value.keys()].map((id) => refreshSession(id)))
  }

  async function cancel(taskId: string): Promise<void> {
    const task = tasksById.value.get(taskId)
    if (!task) {
      return
    }
    if (task.provider === 'ftp') {
      await ftpApi.transferCancel({ taskId })
    } else if (task.provider === 'sftp') {
      await sftpApi.transferCancel({ taskId })
    } else {
      const { sshApi } = await import('@/api/ssh')
      await sshApi.transferCancel({ taskId })
    }
    await refreshSession(task.sessionId)
  }

  async function pause(taskId: string): Promise<void> {
    const task = tasksById.value.get(taskId)
    if (!task) {
      return
    }
    if (task.provider === 'ftp') {
      await ftpApi.transferPause({ taskId })
      return
    }
    if (task.provider === 'sftp') {
      await sftpApi.transferPause({ taskId })
      return
    }
    const { sshApi } = await import('@/api/ssh')
    await sshApi.transferPause({ taskId })
  }

  async function resume(taskId: string): Promise<void> {
    const task = tasksById.value.get(taskId)
    if (!task) {
      return
    }
    if (task.provider === 'ftp') {
      await ftpApi.transferResume({ taskId })
      return
    }
    if (task.provider === 'sftp') {
      await sftpApi.transferResume({ taskId })
      return
    }
    const { sshApi } = await import('@/api/ssh')
    await sshApi.transferResume({ taskId })
  }

  subscribeBridgeEventByPrefix('ftp.transfer.', applyEvent)
  subscribeBridgeEventByPrefix('ssh.transfer.', applyEvent)
  subscribeBridgeEventByPrefix('sftp.transfer.', applyEvent)

  return {
    tasks,
    sessions,
    activeCount,
    hasActiveTransfers,
    registerSession,
    unregisterSession,
    refreshSession,
    refreshAll,
    cancel,
    pause,
    resume,
    providerForSession,
  }
})
