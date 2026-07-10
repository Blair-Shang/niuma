<script setup lang="ts">
import { RsTerminal } from '@niuma/ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import { useMongoShell } from '@/modules/mongodb/composables/useMongoShell'
import { formatMongoJson } from '@/modules/mongodb/utils/format'
import { loadMongoToolPaths } from '@/modules/mongodb/utils/tool-paths'

const props = defineProps<{
  sessionId: string | null
  hostAddress?: string | null
  portNumber?: number | null
}>()

const { t } = useI18n()
const terminalRef = ref<InstanceType<typeof RsTerminal> | null>(null)
const terminalReady = ref(false)
const mode = ref<'detecting' | 'pty' | 'repl'>('detecting')
const toolPaths = ref<Record<string, string>>({})
const startupError = ref('')
const pty = useMongoShell()

const overlayText = computed(() => {
  if (!props.sessionId) {
    return t('modules.mongodb.console.noSession')
  }
  if (mode.value === 'detecting') {
    return t('modules.mongodb.console.detecting')
  }
  if (mode.value === 'pty') {
    if (startupError.value) {
      return startupError.value
    }
    if (pty.state.value === 'opening') {
      return t('modules.mongodb.console.shellOpening')
    }
  }
  return ''
})

let line = ''
let running = false
let pendingOutput = ''
let flushScheduled = false
let inputQueue = Promise.resolve()
let openingForSessionId = ''

function prompt(): string {
  const host = props.hostAddress?.trim()
  const port = props.portNumber ?? 27017
  return host ? `${host}:${port}> ` : 'mongodb> '
}

function writeln(text: string): void {
  terminalRef.value?.write(`${text}\r\n`)
}

function writePrompt(): void {
  terminalRef.value?.write(prompt())
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

function calcGeometry(): { cols: number; rows: number } | null {
  const terminal = terminalRef.value?.getTerminal()
  if (!terminal) {
    return null
  }
  return {
    cols: terminal.cols || 80,
    rows: terminal.rows || 24,
  }
}

async function detectMode(): Promise<void> {
  mode.value = 'detecting'
  toolPaths.value = await loadMongoToolPaths()
  try {
    const detected = await mongodbApi.shellDetect({ toolPaths: toolPaths.value })
    mode.value = detected.available ? 'pty' : 'repl'
  } catch {
    mode.value = 'repl'
  }
}

async function openPty(sessionId: string): Promise<void> {
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
    await pty.openShell(
      {
        sessionId,
        cols: Math.max(geometry.cols, 20),
        rows: Math.max(geometry.rows, 5),
        toolPaths: toolPaths.value,
      },
      (event) => {
        pendingOutput += event.data
        scheduleFlush()
      },
    )
    const geo = calcGeometry()
    if (geo) {
      await pty.resize(Math.max(geo.cols, 20), Math.max(geo.rows, 5))
    }
  } catch (e) {
    startupError.value = e instanceof Error ? e.message : t('modules.mongodb.console.shellError')
    mode.value = 'repl'
    await nextTick()
    writePrompt()
  } finally {
    openingForSessionId = ''
  }
}

async function prepareConsole(sessionId: string): Promise<void> {
  await detectMode()
  if (mode.value === 'pty') {
    await openPty(sessionId)
    return
  }
  if (mode.value === 'repl') {
    await nextTick()
    terminalRef.value?.clear()
    writeln(t('modules.mongodb.console.replBanner'))
    writePrompt()
  }
}

async function execLine(input: string): Promise<void> {
  if (!props.sessionId) {
    return
  }
  running = true
  try {
    const result = await mongodbApi.commandExec({ sessionId: props.sessionId, input })
    if (result.error) {
      writeln(result.error)
    } else if (result.output) {
      try {
        const parsed = JSON.parse(result.output) as unknown
        writeln(formatMongoJson(parsed))
      } catch {
        writeln(result.output)
      }
    }
  } catch (e) {
    writeln(e instanceof Error ? e.message : t('modules.mongodb.console.execError'))
  } finally {
    running = false
    writePrompt()
  }
}

function onData(data: string): void {
  if (!props.sessionId) {
    return
  }
  if (mode.value === 'pty') {
    if (!data) {
      return
    }
    inputQueue = inputQueue.then(() => pty.input(data)).catch(() => undefined)
    return
  }
  if (running) {
    return
  }
  for (const ch of data) {
    if (ch === '\r') {
      continue
    }
    if (ch === '\n') {
      writeln('')
      const cmd = line
      line = ''
      if (cmd.trim()) {
        void execLine(cmd)
      } else {
        writePrompt()
      }
      continue
    }
    if (ch === '\u007f') {
      if (line.length > 0) {
        line = line.slice(0, -1)
        terminalRef.value?.write('\b \b')
      }
      continue
    }
    if (ch >= ' ') {
      line += ch
      terminalRef.value?.write(ch)
    }
  }
}

function onReady(): void {
  terminalReady.value = true
  if (props.sessionId) {
    void prepareConsole(props.sessionId)
  }
}

onMounted(() => {
  if (terminalReady.value && props.sessionId) {
    void prepareConsole(props.sessionId)
  }
})

watch(
  () => props.sessionId,
  async (next, prev) => {
    if (!terminalReady.value) {
      return
    }
    if (prev && prev !== next) {
      await pty.close()
      line = ''
      running = false
    }
    if (next && next !== openingForSessionId) {
      await prepareConsole(next)
    }
  },
)

onBeforeUnmount(() => {
  pendingOutput = ''
  flushScheduled = false
  pty.close().catch(() => undefined)
})
</script>

<template>
  <div class="nm-mongo-console">
    <RsTerminal
      ref="terminalRef"
      class="nm-mongo-console__terminal"
      :overlay-text="overlayText"
      :normalize-newlines="false"
      @data="onData"
      @ready="onReady"
    />
    <p class="nm-mongo-console__hint">
      {{
        mode === 'pty'
          ? t('modules.mongodb.console.hintPty')
          : t('modules.mongodb.console.hintRepl')
      }}
    </p>
  </div>
</template>

<style scoped>
.nm-mongo-console {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-mongo-console__terminal {
  flex: 1;
  min-height: 0;
}

.nm-mongo-console__hint {
  margin: 0;
  padding: var(--rs-space-xs) var(--rs-space-md);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  border-top: 1px solid var(--rs-border-subtle);
}
</style>
