import { onBeforeUnmount, ref } from 'vue'
import { mongodbApi, subscribeBridgeEventByPrefix } from '@/api'
import type { MongoShellOutputEvent, MongoShellStateEvent } from '@/api/types/mongodb'

type MongoShellEvent = MongoShellOutputEvent | MongoShellStateEvent

export type MongoShellState = 'closed' | 'opening' | 'connected'

interface OpenShellParams {
  sessionId: string
  cols: number
  rows: number
  toolPaths?: Record<string, string>
}

export function useMongoShell() {
  const shellId = ref<string | null>(null)
  const state = ref<MongoShellState>('closed')
  let offEvent: (() => void) | null = null

  function ensureSubscribed(onData: (event: MongoShellOutputEvent) => void): void {
    if (offEvent) {
      return
    }
    offEvent = subscribeBridgeEventByPrefix('mongodb.shell.', (detail) => {
      if (typeof detail !== 'object' || detail === null) {
        return
      }
      const event = detail as MongoShellEvent
      if (!shellId.value || event.shellId !== shellId.value) {
        return
      }
      if (event.type === 'mongodb.shell.output') {
        onData(event)
        return
      }
      if (event.type === 'mongodb.shell.state') {
        if (event.state === 'opening') {
          state.value = 'opening'
        } else if (event.state === 'connected') {
          state.value = 'connected'
        } else if (event.state === 'closed') {
          state.value = 'closed'
        }
      }
    })
  }

  async function openShell(params: OpenShellParams, onData: (event: MongoShellOutputEvent) => void): Promise<string> {
    ensureSubscribed(onData)
    state.value = 'opening'
    try {
      const result = await mongodbApi.shellOpen(params)
      shellId.value = result.shellId
      // Open 返回时 PTY 已启动。connected 事件在 RPC 返回前发出，此时 shellId 仍为空会被丢弃。
      if (state.value === 'opening') {
        state.value = 'connected'
      }
      return result.shellId
    } catch (err) {
      state.value = 'closed'
      throw err
    }
  }

  async function input(data: string): Promise<void> {
    if (!shellId.value || !data) {
      return
    }
    await mongodbApi.shellInput({ shellId: shellId.value, data })
  }

  async function resize(cols: number, rows: number): Promise<void> {
    if (!shellId.value || cols <= 0 || rows <= 0) {
      return
    }
    await mongodbApi.shellResize({ shellId: shellId.value, cols, rows })
  }

  async function close(): Promise<void> {
    const current = shellId.value
    shellId.value = null
    state.value = 'closed'
    if (!current) {
      return
    }
    try {
      await mongodbApi.shellClose({ shellId: current })
    } catch {
      // session 关闭时 shell 可能已被回收
    }
  }

  onBeforeUnmount(() => {
    offEvent?.()
    offEvent = null
  })

  return {
    shellId,
    state,
    openShell,
    input,
    resize,
    close,
  }
}
