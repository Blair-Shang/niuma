import { onBeforeUnmount, ref } from 'vue'
import { shellStreamApi, sshApi, subscribeBridgeEventByPrefix } from '@/api'
import { STREAM_SSH_TERMINAL } from '@/modules/ssh/stream'
import type {
  SshTerminalDataEvent,
  SshTerminalExitEvent,
  SshTerminalState,
  SshTerminalStateEvent,
} from '@/api/types/ssh'

type SshTerminalEvent = SshTerminalDataEvent | SshTerminalExitEvent | SshTerminalStateEvent

interface OpenTerminalParams {
  sessionId: string
  cols: number
  rows: number
  termType?: string
}

export function useSshTerminal() {
  const terminalId = ref<string | null>(null)
  const state = ref<SshTerminalState>('closed')
  const message = ref('')
  const exitCode = ref<number | null>(null)
  let offEvent: (() => void) | null = null
  let streamSessionId: string | null = null

  function ensureSubscribed(onData: (event: SshTerminalDataEvent) => void): void {
    if (offEvent) {
      return
    }
    offEvent = subscribeBridgeEventByPrefix('ssh.terminal.', (detail) => {
      if (typeof detail !== 'object' || detail === null) {
        return
      }
      const event = detail as SshTerminalEvent
      if (!terminalId.value || event.terminalId !== terminalId.value) {
        return
      }
      if (event.type === 'ssh.terminal.data') {
        onData(event)
        return
      }
      if (event.type === 'ssh.terminal.exit') {
        exitCode.value = typeof event.exitCode === 'number' ? event.exitCode : null
        return
      }
      state.value = event.state
      message.value = event.message ?? ''
    })
  }

  async function openStream(termId: string): Promise<void> {
    streamSessionId = `ssh-term-${termId}`
    await shellStreamApi.open({
      method: STREAM_SSH_TERMINAL,
      id: streamSessionId,
      paramsJson: JSON.stringify({ terminalId: termId }),
    })
  }

  async function closeStream(): Promise<void> {
    const current = streamSessionId
    streamSessionId = null
    if (!current) {
      return
    }
    try {
      await shellStreamApi.close({ id: current })
    } catch {
      // 会话关闭时流可能已断开，忽略
    }
  }

  async function openTerminal(params: OpenTerminalParams, onData: (event: SshTerminalDataEvent) => void): Promise<string> {
    ensureSubscribed(onData)
    state.value = 'opening'
    message.value = ''
    exitCode.value = null
    const result = await sshApi.terminalOpen(params)
    terminalId.value = result.terminalId
    await openStream(result.terminalId)
    state.value = 'ready'
    return result.terminalId
  }

  function input(data: string): void {
    if (!terminalId.value || !data) {
      return
    }
    void sshApi.terminalInput({ terminalId: terminalId.value, data })
  }

  async function resize(cols: number, rows: number): Promise<void> {
    if (!terminalId.value || cols <= 0 || rows <= 0) {
      return
    }
    await sshApi.terminalResize({ terminalId: terminalId.value, cols, rows })
  }

  async function close(): Promise<void> {
    const current = terminalId.value
    terminalId.value = null
    state.value = 'closed'
    await closeStream()
    if (!current) {
      return
    }
    try {
      await sshApi.terminalClose({ terminalId: current })
    } catch {
      // session 关闭时服务端已回收终端，"terminal not found" 属于预期，静默忽略
    }
  }

  onBeforeUnmount(() => {
    offEvent?.()
    offEvent = null
    void closeStream()
  })

  return {
    terminalId,
    state,
    message,
    exitCode,
    openTerminal,
    input,
    resize,
    close,
  }
}
