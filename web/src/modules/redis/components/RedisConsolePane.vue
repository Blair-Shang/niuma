<script setup lang="ts">
/**
 * Redis 控制台 —— 基于 `RsTerminal`（xterm.js）的真实终端渲染，而非 HTML div 拼出来的仿终端。
 *
 * 与真正的 SSH/PTY 终端不同，Redis 协议是一问一答的请求/响应模型，后端没有一个可以持续吐字符流
 * 的 shell 进程，所以这里在 xterm 之上自己实现了一个极简的“本地行编辑器”（local echo）：
 * - 逐键解析 `terminal.onData()` 吐出的原始数据（可打印字符 / Backspace / 方向键 / Tab / Ctrl+C 等），
 *   在内存里维护当前行 `line` 与光标位置 `cursor`，每次变化后整行重绘（避免手工计算增量光标偏移）。
 * - 命令名/子命令补全对齐 bash 的 Tab 语义：唯一候选直接补全；多个候选先尽量补全到公共前缀，
 *   补不动了再把候选列表打印到下一行（bash 双击 Tab 的效果）。
 * - 剩余参数提示以“幽灵文本”（dim 幽灵字符，fish-shell / VS Code 风格）方式跟在光标之后展示，
 *   仅用于查看，不是可插入文本，因此不参与 Tab 补全。
 *
 * 内存/性能上的注意点：`line`/`cursor`/历史记录都用普通变量而非 Vue `ref`，因为它们只驱动“写终端”
 * 这个副作用，不需要参与 Vue 的响应式渲染；命令历史上限见 `MAX_HISTORY_ENTRIES`，避免长时间会话
 * 里无限增长。
 */
import { RsTerminal } from '@niuma/ui'
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { redisApi } from '@/api'
import type { RedisCommandSuggestion } from '@/api/types/redis'
import { useRedisSuggest } from '@/modules/redis/composables/useRedisSuggest'
import { parseSelectDatabase, redisDatabaseKey } from '@/modules/redis/composables/useRedisDatabase'
import { formatRedisReply, splitCommandLine } from '@/modules/redis/utils/format'

const props = defineProps<{
  sessionId: string | null
  /** 用于拼出 `host:port>` 提示符，贴近原生 `redis-cli`；未提供时退化为通用 `>` 提示符。 */
  hostAddress?: string | null
  portNumber?: number | null
}>()

/** 本地伪命令：不发往 Redis，只用于清空当前终端屏幕，贴近真实 shell 的 `clear` 习惯。 */
const LOCAL_CLEAR_COMMANDS = new Set(['clear', 'cls'])
/** 命令历史上限，避免长时间会话下无限增长占用内存。 */
const MAX_HISTORY_ENTRIES = 500

const ANSI_RESET = '\x1b[0m'
const ANSI_DIM = '\x1b[2m'
const ANSI_RED = '\x1b[31m'
const ANSI_CYAN = '\x1b[36m'
const ANSI_PROMPT = '\x1b[1;32m'

const { t } = useI18n()

const redisDb = inject(redisDatabaseKey, null)

const terminalRef = ref<InstanceType<typeof RsTerminal> | null>(null)
const overlayText = computed(() => (props.sessionId ? '' : t('modules.redis.console.noSession')))

const { suggestions, schedule: scheduleSuggest, clear: clearSuggest } = useRedisSuggest(() => props.sessionId)

/** 命令名/子命令名前缀候选（Tab 可补全）；与「参数收窄提示」互斥。 */
const dropdownItems = computed<RedisCommandSuggestion[]>(() =>
  suggestions.value.filter((s) => s.remainingArguments === undefined),
)
/** 命令名已敲完时的剩余参数语法提示，仅展示（幽灵文本），不可通过 Tab 插入。 */
const argumentHint = computed<RedisCommandSuggestion | null>(() => {
  if (suggestions.value.length !== 1) {
    return null
  }
  const only = suggestions.value[0]
  return only.remainingArguments !== undefined ? only : null
})

// --- 行编辑器状态：纯变量，只驱动终端重绘这一个副作用，不需要 Vue 响应式 ---
let line = ''
let cursor = 0
let running = false
const cmdHistory: string[] = []
let historyCursor = -1
let draftBeforeHistory = ''

/** 候选/提示异步到达（防抖之后）时，若当前不在等待命令回包，则刷新幽灵文本。 */
watch(suggestions, () => {
  if (!running) {
    redraw()
  }
})

watch(
  () => redisDb?.currentDb.value,
  () => {
    if (!running) {
      redraw()
    }
  },
)

watch(
  () => props.sessionId,
  (id, prev) => {
    if (id && id !== prev) {
      void nextTick(() => startFresh())
    }
  },
)

function promptAddr(): string {
  if (!props.hostAddress) {
    return ''
  }
  return props.portNumber ? `${props.hostAddress}:${props.portNumber}` : props.hostAddress
}

function promptPlainText(): string {
  const addr = promptAddr()
  const dbSuffix = redisDb?.canSwitchDb.value ? `[${redisDb.currentDb.value}]` : ''
  if (addr) {
    return `${addr}${dbSuffix}> `
  }
  return dbSuffix ? `${dbSuffix}> ` : '> '
}

/** 东亚全角/宽字符按 2 列估算，组合符号按 0 列，其余按 1 列——足够覆盖 Redis 常见的中文 value。 */
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

/**
 * 把任意换行形式（LF / CR / CRLF）统一转换为 xterm 需要的 CRLF。
 * 先把已有的 CRLF 去掉多余的 CR，再把单独的 CR 也统一成 LF，最后整体替换为 CRLF，
 * 避免对 `\r\n` 先做 `\r\n` → `\r\r\n` 的重复插入。
 */
function toTerminalEol(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\n', '\r\n')
}

/** 过滤掉不可打印的控制字符（含换行）：避免粘贴内容里混入 ESC 序列破坏重绘，也避免多行粘贴被当作连续回车自动执行多条命令。 */
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

/** 若唯一候选是「当前行的一个更长前缀」，返回其完整名字（用于幽灵补全预览与 Tab/→ 补全）。 */
function singleNameGhost(): string | null {
  const items = dropdownItems.value
  if (items.length !== 1) {
    return null
  }
  const name = items[0].name
  if (name.length > line.length && name.toLowerCase().startsWith(line.toLowerCase())) {
    return name
  }
  return null
}

function computeGhost(): string {
  if (cursor !== line.length || !line) {
    return ''
  }
  const nameGhost = singleNameGhost()
  if (nameGhost) {
    return nameGhost.slice(line.length)
  }
  const hint = argumentHint.value
  if (hint?.remainingArguments) {
    return hint.remainingArguments.startsWith(' ') ? hint.remainingArguments : ` ${hint.remainingArguments}`
  }
  return ''
}

/**
 * 整行重绘：回到行首、擦除到行尾、重写「提示符 + 当前输入 + 幽灵文本」，再把光标绝对定位到
 * 应在的列。用绝对列定位（CHA）代替相对光标移动，避免累积误差；代价是只处理单行不折行的场景，
 * 对 Redis 控制台的典型输入长度足够。
 */
function redraw(): void {
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
  redraw()
  scheduleSuggest(line, true)
}

function insertText(raw: string): void {
  const text = sanitizeInsertable(raw)
  if (!text) {
    return
  }
  line = line.slice(0, cursor) + text + line.slice(cursor)
  cursor += text.length
  redraw()
  scheduleSuggest(line)
}

function backspace(): void {
  if (cursor === 0) {
    return
  }
  line = line.slice(0, cursor - 1) + line.slice(cursor)
  cursor -= 1
  redraw()
  scheduleSuggest(line)
}

function deleteForward(): void {
  if (cursor >= line.length) {
    return
  }
  line = line.slice(0, cursor) + line.slice(cursor + 1)
  redraw()
  scheduleSuggest(line)
}

function moveCursor(delta: number): void {
  cursor = Math.max(0, Math.min(line.length, cursor + delta))
  redraw()
}

function moveCursorTo(pos: number): void {
  cursor = Math.max(0, Math.min(line.length, pos))
  redraw()
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

/** 多个候选共享的最长公共前缀（大小写不敏感比较，返回时保留第一个候选的原始大小写）。 */
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

/** 把候选命令名以多列形式打印到下一行（bash 二次按 Tab 展示候选列表的效果），随后在新行重绘输入框。 */
function writeCandidateList(items: RedisCommandSuggestion[]): void {
  const term = terminalRef.value
  const raw = term?.getTerminal()
  if (!term || !raw) {
    return
  }
  const cols = raw.cols || 80
  const names = items.map((item) => item.name)
  const colWidth = Math.min(cols, Math.max(...names.map((n) => n.length)) + 2)
  const perRow = Math.max(1, Math.floor(cols / colWidth))
  let out = '\r\n'
  names.forEach((name, idx) => {
    out += `${ANSI_CYAN}${name.padEnd(colWidth)}${ANSI_RESET}`
    if ((idx + 1) % perRow === 0) {
      out += '\r\n'
    }
  })
  if (names.length % perRow !== 0) {
    out += '\r\n'
  }
  term.write(out)
  redraw()
}

/**
 * Bash 风格的 Tab 补全：唯一候选直接补全（含尾随空格）；多个候选时先尽量补全到公共前缀
 * （还可继续输入进一步收窄），补不动了（已处于公共前缀）则把候选列表打印出来。
 */
function handleTab(): void {
  const items = dropdownItems.value
  if (items.length === 0) {
    return
  }
  if (items.length === 1) {
    setLine(`${items[0].name} `)
    return
  }
  const lcp = longestCommonPrefix(items.map((item) => item.name))
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
  redraw()
}

function handleCtrlL(): void {
  terminalRef.value?.clear()
  redraw()
}

async function submitLine(): Promise<void> {
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
    redraw()
    return
  }
  cmdHistory.push(raw)
  if (cmdHistory.length > MAX_HISTORY_ENTRIES) {
    cmdHistory.shift()
  }
  historyCursor = -1

  if (LOCAL_CLEAR_COMMANDS.has(trimmed.toLowerCase())) {
    term.clear()
    redraw()
    return
  }
  if (!props.sessionId) {
    term.write(`${ANSI_RED}(error) ${t('modules.redis.console.noSession')}${ANSI_RESET}\r\n`)
    redraw()
    return
  }
  const args = splitCommandLine(raw)
  if (args.length === 0) {
    redraw()
    return
  }

  running = true
  try {
    const result = await redisApi.commandExec({ sessionId: props.sessionId, args })
    const selectDb = parseSelectDatabase(args)
    if (selectDb !== null) {
      redisDb?.applySelectFromCommand(selectDb)
    }
    const text = formatRedisReply(result.reply)
    term.write(`${toTerminalEol(text)}\r\n${ANSI_DIM}(${result.elapsedMs.toFixed(1)} ms)${ANSI_RESET}\r\n`)
  } catch (e) {
    const message = e instanceof Error ? e.message : t('modules.redis.console.execError')
    term.write(`${ANSI_RED}(error) ${message}${ANSI_RESET}\r\n`)
  } finally {
    running = false
    redraw()
  }
}

function handleData(data: string): void {
  if (running) {
    // 命令执行期间忽略键入，贴近 redis-cli 同步阻塞等待回包的体验。
    return
  }
  switch (data) {
    case '\r':
    case '\n':
      void submitLine()
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
      redraw()
      return
    default:
      if (!data.startsWith('\x1b')) {
        insertText(data)
      }
  }
}

function startFresh(): void {
  const term = terminalRef.value
  if (!term) {
    return
  }
  line = ''
  cursor = 0
  running = false
  historyCursor = -1
  draftBeforeHistory = ''
  clearSuggest()
  term.clear()
  term.write(`${ANSI_DIM}${t('modules.redis.console.empty')}${ANSI_RESET}\r\n\r\n`)
  redraw()
  term.focus()
}

function onTerminalReady(): void {
  if (props.sessionId) {
    startFresh()
  }
}

onBeforeUnmount(() => {
  clearSuggest()
})
</script>

<template>
  <section class="nm-redis-console">
    <RsTerminal
      ref="terminalRef"
      :overlay="overlayText"
      wheel-scroll-modifier="shift"
      @ready="onTerminalReady"
      @data="handleData"
    />
  </section>
</template>

<style scoped>
.nm-redis-console {
  height: 100%;
  min-height: 0;
}
</style>
