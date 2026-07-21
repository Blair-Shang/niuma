<script setup lang="ts">
import { RsTerminal } from '@niuma/ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import { useMongoCommandSuggest } from '@/modules/mongodb/composables/useMongoCommandSuggest'
import { useMongoShell } from '@/modules/mongodb/composables/useMongoShell'
import { formatMongoJson } from '@/modules/mongodb/utils/format'
import { loadMongoToolPaths } from '@/modules/mongodb/utils/tool-paths'

const props = defineProps<{
  sessionId: string | null
  hostAddress?: string | null
  portNumber?: number | null
}>()

const LOCAL_CLEAR_COMMANDS = new Set(['clear', 'cls'])
const MAX_HISTORY_ENTRIES = 500

const ANSI_RESET = '\x1b[0m'
const ANSI_DIM = '\x1b[2m'
const ANSI_RED = '\x1b[31m'
const ANSI_CYAN = '\x1b[36m'
const ANSI_PROMPT = '\x1b[1;32m'

const { t } = useI18n()
const terminalRef = ref<InstanceType<typeof RsTerminal> | null>(null)
const terminalReady = ref(false)
const mode = ref<'detecting' | 'pty' | 'repl'>('detecting')
const toolPaths = ref<Record<string, string>>({})
const startupError = ref('')
const replReason = ref('')
const pty = useMongoShell()

const { suggestions, schedule: scheduleSuggest, clear: clearSuggest } = useMongoCommandSuggest(
  () => props.sessionId,
)

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
let cursor = 0
let running = false
let pendingOutput = ''
let flushScheduled = false
let inputQueue = Promise.resolve()
let openingForSessionId = ''
const cmdHistory: string[] = []
let historyCursor = -1
let draftBeforeHistory = ''

function promptPlainText(): string {
  const host = props.hostAddress?.trim()
  const port = props.portNumber ?? 27017
  return host ? `${host}:${port}> ` : 'mongodb> '
}

/** 将 LF/CR 统一为 xterm 所需的 CRLF，避免多行 JSON 出现阶梯错位。 */
function toTerminalEol(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\n', '\r\n')
}

function writeln(text: string): void {
  terminalRef.value?.write(`${toTerminalEol(text)}\r\n`)
}

function charWidth(codePoint: number): number {
  if (codePoint >= 0x0300 && codePoint <= 0x036f) {
    return 0
  }
  const isWide =
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  return isWide ? 2 : 1
}

function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    width += charWidth(ch.codePointAt(0) ?? 0)
  }
  return width
}

function sanitizeInsertable(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x20 && code !== 0x7f) {
      out += ch
    }
  }
  return out
}

function matchingSuggestions(): string[] {
  if (cursor !== line.length) {
    return []
  }
  const lower = line.toLowerCase()
  return suggestions.value.filter(
    (item) => item.length >= line.length && item.toLowerCase().startsWith(lower),
  )
}

function singleNameGhost(): string | null {
  const items = matchingSuggestions()
  if (items.length !== 1) {
    return null
  }
  const name = items[0]
  if (name.length > line.length) {
    return name
  }
  return null
}

function computeGhost(): string {
  if (cursor !== line.length || !line) {
    return ''
  }
  const ghost = singleNameGhost()
  return ghost ? ghost.slice(line.length) : ''
}

function redrawReplLine(): void {
  const term = terminalRef.value
  if (!term) {
    return
  }
  const promptText = promptPlainText()
  const ghost = computeGhost()
  let out = `\x1b[G\x1b[K${ANSI_PROMPT}${promptText}${ANSI_RESET}${line}`
  if (ghost) {
    out += `${ANSI_DIM}${ghost}${ANSI_RESET}`
  }
  const col = displayWidth(promptText) + displayWidth(line.slice(0, cursor)) + 1
  out += `\x1b[${col}G`
  term.write(out)
}

function setLine(text: string, pos?: number): void {
  line = text
  cursor = pos ?? text.length
  redrawReplLine()
  scheduleSuggest(line, true)
}

function insertText(raw: string): void {
  const text = sanitizeInsertable(raw)
  if (!text) {
    return
  }
  line = line.slice(0, cursor) + text + line.slice(cursor)
  cursor += text.length
  redrawReplLine()
  scheduleSuggest(line)
}

function backspace(): void {
  if (cursor === 0) {
    return
  }
  line = line.slice(0, cursor - 1) + line.slice(cursor)
  cursor -= 1
  redrawReplLine()
  scheduleSuggest(line)
}

function deleteForward(): void {
  if (cursor >= line.length) {
    return
  }
  line = line.slice(0, cursor) + line.slice(cursor + 1)
  redrawReplLine()
  scheduleSuggest(line)
}

function moveCursor(delta: number): void {
  cursor = Math.max(0, Math.min(line.length, cursor + delta))
  redrawReplLine()
}

function moveCursorTo(pos: number): void {
  cursor = Math.max(0, Math.min(line.length, pos))
  redrawReplLine()
}

function acceptEndGhost(): void {
  const candidate = singleNameGhost()
  if (candidate) {
    setLine(`${candidate} `)
    return
  }
  moveCursor(1)
}

function navigateHistory(direction: -1 | 1): void {
  if (cmdHistory.length === 0) {
    return
  }
  if (historyCursor === -1) {
    if (direction !== -1) {
      return
    }
    draftBeforeHistory = line
    historyCursor = cmdHistory.length - 1
    setLine(cmdHistory[historyCursor])
    return
  }
  const next = historyCursor + direction
  if (next < 0) {
    return
  }
  if (next >= cmdHistory.length) {
    historyCursor = -1
    setLine(draftBeforeHistory)
    return
  }
  historyCursor = next
  setLine(cmdHistory[next])
}

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) {
    return ''
  }
  let prefix = values[0]
  for (let i = 1; i < values.length && prefix; i += 1) {
    const value = values[i]
    const max = Math.min(prefix.length, value.length)
    let matched = 0
    while (matched < max && prefix[matched].toLowerCase() === value[matched].toLowerCase()) {
      matched += 1
    }
    prefix = prefix.slice(0, matched)
  }
  return prefix
}

function writeCandidateList(items: string[]): void {
  const term = terminalRef.value
  const raw = term?.getTerminal()
  if (!term || !raw) {
    return
  }
  const cols = raw.cols || 80
  const colWidth = Math.min(cols, Math.max(...items.map((n) => n.length)) + 2)
  const perRow = Math.max(1, Math.floor(cols / colWidth))
  let out = '\r\n'
  items.forEach((name, idx) => {
    out += `${ANSI_CYAN}${name.padEnd(colWidth)}${ANSI_RESET}`
    if ((idx + 1) % perRow === 0) {
      out += '\r\n'
    }
  })
  if (items.length % perRow !== 0) {
    out += '\r\n'
  }
  term.write(out)
  redrawReplLine()
}

function handleTab(): void {
  const items = matchingSuggestions()
  if (items.length === 0) {
    return
  }
  if (items.length === 1) {
    setLine(`${items[0]} `)
    return
  }
  const lcp = longestCommonPrefix(items)
  if (lcp.length > line.length && lcp.toLowerCase().startsWith(line.toLowerCase())) {
    setLine(lcp, lcp.length)
    return
  }
  writeCandidateList(items)
}

function handleCtrlC(): void {
  const term = terminalRef.value
  clearSuggest()
  term?.write('^C\r\n')
  line = ''
  cursor = 0
  historyCursor = -1
  redrawReplLine()
}

function handleCtrlL(): void {
  terminalRef.value?.clear()
  redrawReplLine()
}

function resetReplEditor(): void {
  line = ''
  cursor = 0
  running = false
  historyCursor = -1
  draftBeforeHistory = ''
  clearSuggest()
}

function startReplEditor(): void {
  resetReplEditor()
  redrawReplLine()
  scheduleSuggest('', true)
  terminalRef.value?.focus()
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
  replReason.value = ''
  toolPaths.value = await loadMongoToolPaths()
  try {
    const detected = await mongodbApi.shellDetect({ toolPaths: toolPaths.value })
    if (detected.available && detected.ptySupported !== false) {
      mode.value = 'pty'
      return
    }
    mode.value = 'repl'
    if (detected.available && detected.ptySupported === false) {
      replReason.value = t('modules.mongodb.console.replBannerWindowsPty')
    }
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
    terminalRef.value?.clear()
    writeln(t('modules.mongodb.console.replBannerPtyFailed', { error: startupError.value }))
    startReplEditor()
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
    writeln(replReason.value || t('modules.mongodb.console.replBanner'))
    writeln(t('modules.mongodb.console.replHint'))
    startReplEditor()
  }
}

async function execLine(input: string): Promise<void> {
  if (!props.sessionId) {
    return
  }
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
  }
}

async function submitReplLine(): Promise<void> {
  const term = terminalRef.value
  if (!term || running) {
    return
  }
  const raw = line
  const trimmed = raw.trim()
  clearSuggest()
  term.write('\r\n')
  line = ''
  cursor = 0

  if (!trimmed) {
    redrawReplLine()
    return
  }
  cmdHistory.push(raw)
  if (cmdHistory.length > MAX_HISTORY_ENTRIES) {
    cmdHistory.shift()
  }
  historyCursor = -1

  if (LOCAL_CLEAR_COMMANDS.has(trimmed.toLowerCase())) {
    term.clear()
    redrawReplLine()
    return
  }
  if (!props.sessionId) {
    term.write(`${ANSI_RED}${t('modules.mongodb.console.noSession')}${ANSI_RESET}\r\n`)
    redrawReplLine()
    return
  }

  running = true
  try {
    await execLine(trimmed)
  } finally {
    running = false
    redrawReplLine()
  }
}

function onReplData(data: string): void {
  if (running) {
    return
  }
  switch (data) {
    case '\r':
    case '\n':
      void submitReplLine()
      return
    case '\x7f':
    case '\b':
      backspace()
      return
    case '\x1b[3~':
      deleteForward()
      return
    case '\x1b[C':
      if (cursor === line.length) {
        acceptEndGhost()
      } else {
        moveCursor(1)
      }
      return
    case '\x1b[D':
      moveCursor(-1)
      return
    case '\x1b[A':
      navigateHistory(-1)
      return
    case '\x1b[B':
      navigateHistory(1)
      return
    case '\x1b[H':
    case '\x1b[1~':
    case '\x01':
      moveCursorTo(0)
      return
    case '\x1b[F':
    case '\x1b[4~':
    case '\x05':
      moveCursorTo(line.length)
      return
    case '\t':
      handleTab()
      return
    case '\x03':
      handleCtrlC()
      return
    case '\x0c':
      handleCtrlL()
      return
    case '\x15':
      setLine('')
      return
    case '\x1b':
      clearSuggest()
      redrawReplLine()
      return
    default:
      if (!data.startsWith('\x1b')) {
        insertText(data)
      }
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
  if (mode.value === 'repl') {
    onReplData(data)
  }
}

watch(suggestions, () => {
  if (mode.value === 'repl' && !running) {
    redrawReplLine()
  }
})

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
      resetReplEditor()
    }
    if (next && next !== openingForSessionId) {
      await prepareConsole(next)
    }
  },
)

onBeforeUnmount(() => {
  pendingOutput = ''
  flushScheduled = false
  clearSuggest()
  pty.close().catch(() => undefined)
})
</script>

<template>
  <div class="nm-mongo-console">
    <RsTerminal
      ref="terminalRef"
      class="nm-mongo-console__terminal"
      :overlay="overlayText"
      :convert-eol="false"
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
