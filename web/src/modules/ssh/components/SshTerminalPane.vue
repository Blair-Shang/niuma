<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RsTerminal, containsEscapeSequence } from '@niuma/ui'
import { useSshTerminal } from '@/modules/ssh/composables/useSshTerminal'
import {
  clearDiagnostic,
  clearEditorSelection,
  publishDiagnostic,
  publishEditorSelection,
} from '@/shell/panels/ai/workspace-context'
import { useTabStore } from '@/stores/tab'

const props = defineProps<{
  sessionId: string | null
  termType?: string
  /** 当开启“同步输入”时，由父组件广播输入到所有分屏 */
  syncBroadcast?: boolean
}>()

const { t } = useI18n()

/** 避免 InstanceType<typeof RsTerminal> 在 Vue 类型上栈溢出 */
type SshTerminalApi = {
  write: (data: string) => void
  clear: () => void
  fit: () => void | Promise<void>
  getTerminal: () => {
    cols?: number
    rows?: number
    options?: Record<string, unknown>
    getSelection?: () => string
    onSelectionChange?: (cb: () => void) => { dispose: () => void }
  } | null
}

const terminalRef = ref<SshTerminalApi | null>(null)
const terminalReady = ref(false)
const startupError = ref('')
let pendingOutput = ''
let flushRaf = 0
const TERMINAL_SCROLLBACK = 5_000
const syncBroadcast = computed(() => props.syncBroadcast ?? false)

const emit = defineEmits<{
  (e: 'broadcastInput', data: string): void
}>()

const pane = useSshTerminal()
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

function cancelScheduledFlush(): void {
  if (flushRaf) {
    cancelAnimationFrame(flushRaf)
    flushRaf = 0
  }
}

function flushOutput(): void {
  flushRaf = 0
  if (!terminalRef.value || !pendingOutput) {
    return
  }
  terminalRef.value.write(pendingOutput)
  pendingOutput = ''
}

function scheduleFlush(): void {
  if (flushRaf) {
    return
  }
  flushRaf = requestAnimationFrame(flushOutput)
}

/** 含 ESC 的控制序列原样立即写入；纯文本可走 rAF 批量。 */
function writeChunk(data: string, stream: 'stdout' | 'stderr'): void {
  const chunk = stream === 'stderr' ? `\x1b[31m${data}\x1b[0m` : data
  if (containsEscapeSequence(chunk)) {
    cancelScheduledFlush()
    flushOutput()
    terminalRef.value?.write(chunk)
    return
  }
  pendingOutput += chunk
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
  cancelScheduledFlush()
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
    await syncPtySize()
  } catch (e) {
    startupError.value = e instanceof Error ? e.message : t('modules.ssh.session.terminalError')
    publishDiagnostic({
      id: `ssh-term:${sessionId}`,
      label: 'SSH Terminal',
      detail: sessionId,
      text: startupError.value,
      kind: 'ssh',
      tabId: useTabStore().activeTabId || undefined,
    })
  } finally {
    openingForSessionId = ''
  }
}

async function refreshSize(): Promise<void> {
  await syncPtySize()
}

async function sendInput(data: string): Promise<void> {
  if (!data) return
  pane.input(data)
}

let selectionDisposable: { dispose: () => void } | null = null
/** 最近一次非空选区；菜单点击失焦后 live selection 常被清空 */
let lastNonEmptySelection = ''
let clearSelectionTimer = 0

function unbindSelection(): void {
  selectionDisposable?.dispose()
  selectionDisposable = null
  if (clearSelectionTimer) {
    window.clearTimeout(clearSelectionTimer)
    clearSelectionTimer = 0
  }
}

function publishTerminalSelection(text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  lastNonEmptySelection = trimmed
  publishEditorSelection({
    tabId: useTabStore().activeTabId || undefined,
    text: trimmed,
    // 终端缓冲（vim/less 等）多为任意文本，勿标成 shell 以免模型按脚本误解
    language: 'text',
    source: 'terminal',
  })
}

function bindSelection(): void {
  unbindSelection()
  const term = terminalRef.value?.getTerminal?.() ?? null
  if (!term || typeof term.onSelectionChange !== 'function') {
    return
  }
  selectionDisposable = term.onSelectionChange(() => {
    const text = String(term.getSelection?.() ?? '').trim()
    const tabId = useTabStore().activeTabId || undefined
    if (!text) {
      // 右键菜单 / 失焦会短暂清空选区；延迟清除，避免 Ask AI 读到空
      if (clearSelectionTimer) window.clearTimeout(clearSelectionTimer)
      clearSelectionTimer = window.setTimeout(() => {
        clearSelectionTimer = 0
        clearEditorSelection(tabId)
      }, 400)
      return
    }
    if (clearSelectionTimer) {
      window.clearTimeout(clearSelectionTimer)
      clearSelectionTimer = 0
    }
    publishTerminalSelection(text)
  })
}

async function askAiAboutSelection(textFromMenu = ''): Promise<void> {
  const term = terminalRef.value?.getTerminal?.() ?? null
  const live = String(term?.getSelection?.() ?? '').trim()
  const text = (textFromMenu || live || lastNonEmptySelection).trim()
  if (text) {
    publishTerminalSelection(text)
  }
  const { executeCommand } = await import('@/extensions/contributions/command-registry')
  await executeCommand('workbench.ai.askSelection')
}

watch(
  () => pane.state.value,
  (state) => {
    const sid = props.sessionId
    if (!sid) {
      return
    }
    if (state === 'error' || state === 'lost') {
      const msg = pane.message.value || state
      publishDiagnostic({
        id: `ssh-term:${sid}`,
        label: 'SSH Terminal',
        detail: sid,
        text: msg,
        kind: 'ssh',
        tabId: useTabStore().activeTabId || undefined,
      })
      return
    }
    if (state === 'ready' || state === 'opening') {
      clearDiagnostic(`ssh-term:${sid}`)
    }
  },
)

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
      await pane.close()
    }
    if (next && next !== openingForSessionId) {
      await openForSession(next)
    }
  },
)

onBeforeUnmount(() => {
  pendingOutput = ''
  cancelScheduledFlush()
  unbindSelection()
  lastNonEmptySelection = ''
  clearEditorSelection(useTabStore().activeTabId || undefined)
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
      show-ask-ai
      :right-click-selects-word="false"
      :snap-viewport-on-tui-write="false"
      wheel-scroll-modifier="shift"
      @ready="async () => {
        terminalReady = true
        applyTerminalLimits()
        bindSelection()
        if (props.sessionId) {
          await openForSession(props.sessionId)
        }
      }"
      @data="(data) => { if (syncBroadcast) { emit('broadcastInput', data) } else { pane.input(data) } }"
      @resize="() => void refreshSize()"
      @ask-ai="(text) => void askAiAboutSelection(text)"
    />
  </section>
</template>

<style scoped>
.nm-ssh-term {
  height: 100%;
  min-height: 0;
}
</style>
