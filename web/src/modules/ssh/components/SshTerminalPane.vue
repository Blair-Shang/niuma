<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RsTerminal } from '@niuma/ui'
import { useSshTerminal } from '@/modules/ssh/composables/useSshTerminal'

const props = defineProps<{
  sessionId: string | null
  termType?: string
  /** 当开启“同步输入”时，由父组件广播输入到所有分屏 */
  syncBroadcast?: boolean
}>()

const { t } = useI18n()
const terminalRef = ref<InstanceType<typeof RsTerminal> | null>(null)
const terminalReady = ref(false)
const startupError = ref('')
let pendingOutput = ''
let flushScheduled = false
const TERMINAL_SCROLLBACK = 20_000
const syncBroadcast = computed(() => props.syncBroadcast ?? false)

const emit = defineEmits<{
  (e: 'broadcastInput', data: string): void
}>()

const pane = useSshTerminal()
let inputQueue = Promise.resolve()
let openingForSessionId = ''

const overlayText = computed(() => {
  if (startupError.value) {
    return startupError.value
  }
  if (!props.sessionId) {
    return t('modules.ssh.session.terminalWaiting')
  }
  if (pane.state.value === 'opening') {
    return t('modules.ssh.session.terminalOpening')
  }
  if (pane.state.value === 'error') {
    return pane.message.value || t('modules.ssh.session.terminalError')
  }
  if (pane.state.value === 'lost') {
    return pane.message.value || t('modules.ssh.session.terminalLost')
  }
  return ''
})

function calcGeometry(): { cols: number; rows: number } | null {
  const terminal = terminalRef.value?.getTerminal()
  if (!terminal) {
    return null
  }
  const cols = terminal.cols || 80
  const rows = terminal.rows || 24
  return { cols, rows }
}

function applyTerminalLimits(): void {
  const terminal = terminalRef.value?.getTerminal()
  if (!terminal) {
    return
  }
  try {
    terminal.options = { ...terminal.options, scrollback: TERMINAL_SCROLLBACK }
  } catch {
    // 兼容不同终端实现，设置失败时保持默认值
  }
}

function flushOutput(): void {
  flushScheduled = false
  if (!terminalRef.value || !pendingOutput) {
    return
  }
  terminalRef.value.write(pendingOutput)
  pendingOutput = ''
}

function scheduleFlush(): void {
  if (flushScheduled) {
    return
  }
  flushScheduled = true
  queueMicrotask(flushOutput)
}

function writeChunk(data: string, stream: 'stdout' | 'stderr'): void {
  pendingOutput += stream === 'stderr' ? `\x1b[31m${data}\x1b[0m` : data
  scheduleFlush()
}

async function syncPtySize(): Promise<void> {
  if (!terminalRef.value || !props.sessionId || !pane.terminalId.value) {
    return
  }
  await terminalRef.value.fit()
  const geometry = calcGeometry()
  if (!geometry) {
    return
  }
  try {
    await pane.resize(Math.max(geometry.cols, 20), Math.max(geometry.rows, 5))
  } catch {
    // resize 失败不打断输入
  }
}

async function openForSession(sessionId: string): Promise<void> {
  if (!terminalRef.value) {
    return
  }
  openingForSessionId = sessionId
  startupError.value = ''
  pendingOutput = ''
  flushScheduled = false
  inputQueue = Promise.resolve()
  terminalRef.value.clear()
  await nextTick()
  await terminalRef.value.fit()
  const geometry = calcGeometry()
  if (!geometry) {
    return
  }
  try {
    await pane.openTerminal(
      {
        sessionId,
        cols: Math.max(geometry.cols, 20),
        rows: Math.max(geometry.rows, 5),
        termType: props.termType || 'xterm-256color',
      },
      (event) => writeChunk(event.data, event.stream),
    )
    // 字体/分栏布局就绪后列数可能变化，再同步一次避免满行后从行首覆盖输入
    await syncPtySize()
  } catch (e) {
    startupError.value = e instanceof Error ? e.message : t('modules.ssh.session.terminalError')
  } finally {
    openingForSessionId = ''
  }
}

async function refreshSize(): Promise<void> {
  await syncPtySize()
}

async function sendInput(data: string): Promise<void> {
  if (!data) return
  inputQueue = inputQueue.then(() => pane.input(data)).catch(() => undefined)
  await inputQueue
}

onMounted(async () => {
  if (terminalReady.value && props.sessionId) {
    applyTerminalLimits()
    await openForSession(props.sessionId)
  }
})

watch(
  () => props.sessionId,
  async (next, prev) => {
    if (!terminalRef.value || !terminalReady.value) {
      return
    }
    if (prev && prev !== next) {
      // session 已关闭时终端可能已被服务端回收，close() 内部已静默处理错误
      await pane.close()
    }
    if (next && next !== openingForSessionId) {
      await openForSession(next)
    }
  },
)

onBeforeUnmount(() => {
  pendingOutput = ''
  flushScheduled = false
  pane.close().catch(() => undefined)
})

defineExpose({
  refreshSize,
  sendInput,
})
</script>

<template>
  <section class="nm-ssh-term">
    <RsTerminal
      ref="terminalRef"
      :overlay="overlayText"
      wheel-scroll-modifier="shift"
      @ready="async () => {
        terminalReady = true
        applyTerminalLimits()
        if (props.sessionId) {
          await openForSession(props.sessionId)
        }
      }"
      @data="(data) => { if (syncBroadcast) { emit('broadcastInput', data) } else { inputQueue = inputQueue.then(() => pane.input(data)).catch(() => undefined) } }"
      @resize="() => void refreshSize()"
    />
  </section>
</template>

<style scoped>
.nm-ssh-term {
  height: 100%;
  min-height: 0;
}
</style>
