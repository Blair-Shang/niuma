import { onBeforeUnmount, ref } from 'vue'
import { subscribeBridgeEventByPrefix } from '@/api'
import type {
  SshExecDataEvent,
  SshExecExitEvent,
  SshExecState,
  SshExecStateEvent,
} from '@/api/types/ssh'

type SshExecEvent = SshExecDataEvent | SshExecExitEvent | SshExecStateEvent

export function useSshExecStream() {
  const execId = ref<string | null>(null)
  const state = ref<SshExecState>('opening')
  const message = ref('')
  const exitCode = ref<number | null>(null)
  let offEvent: (() => void) | null = null

  function ensureSubscribed(onData: (event: SshExecDataEvent) => void): void {
    if (offEvent) {
      return
    }
    offEvent = subscribeBridgeEventByPrefix('ssh.exec.', (detail) => {
      if (typeof detail !== 'object' || detail === null) {
        return
      }
      const event = detail as SshExecEvent
      if (!execId.value || event.execId !== execId.value) {
        return
      }
      if (event.type === 'ssh.exec.data') {
        onData(event)
        return
      }
      if (event.type === 'ssh.exec.exit') {
        exitCode.value = typeof event.exitCode === 'number' ? event.exitCode : null
        return
      }
      state.value = event.state
      message.value = event.message ?? ''
    })
  }

  function attach(id: string, onData: (event: SshExecDataEvent) => void): void {
    ensureSubscribed(onData)
    execId.value = id
    state.value = 'opening'
    message.value = ''
    exitCode.value = null
  }

  function reset(): void {
    execId.value = null
    state.value = 'opening'
    message.value = ''
    exitCode.value = null
  }

  onBeforeUnmount(() => {
    offEvent?.()
    offEvent = null
  })

  return {
    execId,
    state,
    message,
    exitCode,
    attach,
    reset,
  }
}
