<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import type { ITheme } from 'xterm'
import { Terminal } from 'xterm'
import 'xterm/css/xterm.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRsI18n } from '../composables/useRsI18n'
import {
  beginClipboardPrefetch,
  copyTextToClipboard,
  readClipboardText,
} from '../utils/rs-clipboard'
import RsContextMenu from './RsContextMenu.vue'
import type { RsContextMenuItem } from './context-menu-utils'
import RsLoading from './RsLoading.vue'
import {
  containsTuiRefreshSequence,
  mergeTerminalTheme,
  prepareTerminalForPtyWrite,
  resolveTerminalTheme,
  terminalShortcutLabel,
  type RsTerminalAction,
  type RsTerminalThemeMode,
} from './terminal-utils'
import {
  attachWheelScrollGuard,
  type RsTerminalWheelScrollModifier,
} from './terminal-wheel'

const TERMINAL_LINE_HEIGHT = 1.2

const props = withDefaults(
  defineProps<{
    loading?: boolean
    overlay?: string
    inputEnabled?: boolean
    cursorBlink?: boolean
    fontFamily?: string
    fontSize?: number
    fontWeight?: 'normal' | 'bold' | '100' | '200' | '300'  | '400' | '500' | '600' | '700' | '800' | '900'
    fontWeightBold?: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
    allowTransparency?: boolean
    /** auto 跟随 data-rs-theme；也可强制 light / dark */
    themeMode?: RsTerminalThemeMode
    /** 覆盖内置调色板中的部分 token */
    theme?: Partial<ITheme>
    contextMenu?: boolean
    shortcuts?: boolean
    scrollback?: number
    /** 将裸 \\n 当作换行；PTY/SSH 建议 false，避免破坏 ncurses(top/vim) */
    convertEol?: boolean
    /** 奇数行斑马纹底色，提升长日志可读性 */
    zebraStripes?: boolean
    /** none：滚轮直接滚 scrollback；shift：仅 Shift+滚轮滚历史，普通滚轮发方向键（SSH/TUI 推荐） */
    wheelScrollModifier?: RsTerminalWheelScrollModifier
    /** TUI 全屏刷新时若视口不在底部，自动滚回底部（修复 top 表头丢失） */
    snapViewportOnTuiWrite?: boolean
  }>(),
  {
    loading: false,
    overlay: '',
    inputEnabled: true,
    cursorBlink: true,
    fontFamily:
      '"SF Mono", "Cascadia Code", "Cascadia Mono", Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: 13,
    fontWeight: '300',
    fontWeightBold: '400',
    allowTransparency: false,
    themeMode: 'auto',
    theme: () => ({}),
    contextMenu: true,
    shortcuts: true,
    scrollback: 5000,
    convertEol: false,
    zebraStripes: true,
    wheelScrollModifier: 'none',
    snapViewportOnTuiWrite: true,
  },
)

const emit = defineEmits<{
  ready: []
  data: [data: string]
  resize: [payload: { cols: number; rows: number }]
  action: [action: RsTerminalAction]
}>()

const { t } = useRsI18n()
const hostEl = ref<HTMLElement | null>(null)
const terminalReady = ref(false)
const hasSelection = ref(false)
const resolvedThemeMode = ref(resolveTerminalTheme(props.themeMode))
/** fit 后量一次真实行高，避免亚像素漂移；非每帧更新 */
const zebraRowStepPx = ref<number | null>(null)

const showLoading = computed(() => !terminalReady.value || props.loading)

const zebraStyle = computed((): Record<string, string> | undefined => {
  if (!props.zebraStripes) {
    return undefined
  }
  const step = zebraRowStepPx.value ?? props.fontSize * TERMINAL_LINE_HEIGHT
  return {
    '--rs-terminal-font-size': `${props.fontSize}px`,
    '--rs-terminal-line-height': String(TERMINAL_LINE_HEIGHT),
    '--rs-terminal-zebra-step': `${step}px`,
  }
})

const contextMenuItems = computed<RsContextMenuItem[]>(() => [
  {
    key: 'copy',
    label: t('terminal.copy', 'Copy'),
    icon: 'copy',
    shortcut: terminalShortcutLabel('C'),
    disabled: false,
  },
  {
    key: 'paste',
    label: t('terminal.paste', 'Paste'),
    icon: 'clipboard-paste',
    shortcut: terminalShortcutLabel('V'),
  },
  {
    key: 'selectAll',
    label: t('terminal.selectAll', 'Select All'),
    icon: 'square-mouse-pointer',
    shortcut: terminalShortcutLabel('A'),
  },
  { key: 'sep-1', label: '', separator: true },
  {
    key: 'clear',
    label: t('terminal.clear', 'Clear Terminal'),
    icon: 'eraser',
    shortcut: terminalShortcutLabel('K'),
    danger: true,
  },
])

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let detachWheelGuard: (() => void) | null = null
let lastGeometry = { cols: 0, rows: 0 }

function resolveAllowTransparency(): boolean {
  return props.allowTransparency || props.zebraStripes
}

function buildXtermTheme(): ITheme {
  // 主题背景保持不透明：反色行 (xterm-fg/bg-257) 依赖 opaque(background)；
  // 斑马纹通过 allowTransparency 让默认单元格透出底层 CSS 渐变。
  return mergeTerminalTheme(resolvedThemeMode.value, props.theme)
}

function applyThemeToTerminal(): void {
  if (!terminal) {
    return
  }
  terminal.options.theme = buildXtermTheme()
}

function syncZebraRowStepFromDom(): void {
  zebraRowStepPx.value = null
  if (!props.zebraStripes || !hostEl.value) {
    return
  }
  const rowEl = hostEl.value.querySelector<HTMLElement>('.xterm-rows > div, .xterm-row')
  const height = rowEl?.offsetHeight ?? 0
  if (height > 0) {
    zebraRowStepPx.value = height
  }
}

function attachWheelGuard(): void {
  detachWheelGuard?.()
  detachWheelGuard = null
  if (!hostEl.value || props.wheelScrollModifier === 'none') {
    return
  }
  detachWheelGuard = attachWheelScrollGuard(hostEl.value, {
    modifier: () => props.wheelScrollModifier,
    inputEnabled: () => props.inputEnabled,
    onArrowKeys: (data) => {
      if (props.inputEnabled) {
        emit('data', data)
      }
    },
  })
}

function refreshResolvedTheme(): void {
  resolvedThemeMode.value = resolveTerminalTheme(props.themeMode)
  applyThemeToTerminal()
}

function currentGeometry(): { cols: number; rows: number } | null {
  if (!terminal) {
    return null
  }
  return {
    cols: terminal.cols || 80,
    rows: terminal.rows || 24,
  }
}

async function rafTwice(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function emitResizeIfChanged(): void {
  const geometry = currentGeometry()
  if (!geometry) {
    return
  }
  if (geometry.cols === lastGeometry.cols && geometry.rows === lastGeometry.rows) {
    return
  }
  lastGeometry = geometry
  emit('resize', geometry)
}

async function fit(): Promise<void> {
  if (!fitAddon || !terminal || !hostEl.value) {
    return
  }
  const { clientWidth, clientHeight } = hostEl.value
  if (clientWidth <= 0 || clientHeight <= 0) {
    return
  }
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready
  }
  if (!fitAddon || !terminal || !hostEl.value) {
    return
  }
  await nextTick()
  if (!fitAddon || !terminal) {
    return
  }
  await rafTwice()
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!fitAddon || !terminal) {
      return
    }
    try {
      fitAddon.fit()
    } catch {
      return
    }
    const dims = fitAddon.proposeDimensions()
    if (dims && dims.cols > 0 && dims.rows > 0) {
      break
    }
    await rafTwice()
  }
  if (!fitAddon || !terminal) {
    return
  }
  emitResizeIfChanged()
  syncZebraRowStepFromDom()
}

function write(data: string): void {
  const term = terminal
  if (!term) {
    return
  }
  if (props.snapViewportOnTuiWrite && containsTuiRefreshSequence(data)) {
    prepareTerminalForPtyWrite(term, data)
  }
  term.write(data)
}

function clear(): void {
  terminal?.clear()
  terminal?.clearSelection()
  hasSelection.value = false
}

function focus(): void {
  terminal?.focus()
}

function syncSelectionState(): void {
  hasSelection.value = Boolean(terminal?.hasSelection())
}

async function copySelection(): Promise<void> {
  if (!terminal?.hasSelection()) {
    return
  }
  const text = terminal.getSelection()
  if (!text) {
    return
  }
  if (await copyTextToClipboard(text)) {
    emit('action', 'copy')
  }
}

async function pasteFromClipboard(): Promise<void> {
  if (!terminal || !props.inputEnabled) {
    return
  }
  terminal.focus()
  const textarea = terminal.element?.querySelector('textarea')
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus()
  }
  const text = await readClipboardText()
  if (!text) {
    return
  }
  terminal.paste(text)
  emit('action', 'paste')
}

function onTerminalContextMenu(): void {
  void beginClipboardPrefetch()
  // xterm 在 target 阶段才 rightClickSelect，须延后同步选中态
  void nextTick(() => {
    syncSelectionState()
  })
}

function selectAll(): void {
  terminal?.selectAll()
  syncSelectionState()
  emit('action', 'selectAll')
}

function clearTerminal(): void {
  clear()
  emit('action', 'clear')
}

async function runTerminalAction(action: RsTerminalAction): Promise<void> {
  if (action === 'copy') {
    await copySelection()
    return
  }
  if (action === 'paste') {
    await pasteFromClipboard()
    return
  }
  if (action === 'selectAll') {
    selectAll()
    return
  }
  if (action === 'clear') {
    clearTerminal()
  }
}

function onContextMenuSelect(key: string): void {
  void runTerminalAction(key as RsTerminalAction)
}

function attachShortcuts(): void {
  if (!terminal || !props.shortcuts) {
    return
  }
  terminal.attachCustomKeyEventHandler((event) => {
    if (!props.shortcuts || event.type !== 'keydown') {
      return true
    }
    const mod = event.metaKey || event.ctrlKey
    if (!mod) {
      return true
    }
    const key = event.key.toLowerCase()
    if (key === 'c' && terminal?.hasSelection()) {
      event.preventDefault()
      event.stopPropagation()
      void copySelection()
      return false
    }
    if (key === 'v') {
      event.preventDefault()
      event.stopPropagation()
      void pasteFromClipboard()
      return false
    }
    if (key === 'a') {
      event.preventDefault()
      event.stopPropagation()
      selectAll()
      return false
    }
    if (key === 'k') {
      event.preventDefault()
      event.stopPropagation()
      clearTerminal()
      return false
    }
    return true
  })
}

watch(
  () => [props.cursorBlink, props.fontFamily, props.fontSize, props.fontWeight, props.fontWeightBold, props.allowTransparency, props.convertEol, props.themeMode, props.theme, props.zebraStripes, props.wheelScrollModifier] as const,
  () => {
    if (!terminal) {
      return
    }
    refreshResolvedTheme()
    terminal.options.cursorBlink = props.cursorBlink
    terminal.options.fontFamily = props.fontFamily
    terminal.options.fontSize = props.fontSize
    terminal.options.fontWeight = props.fontWeight
    terminal.options.fontWeightBold = props.fontWeightBold
    terminal.options.allowTransparency = resolveAllowTransparency()
    terminal.options.convertEol = props.convertEol
    attachWheelGuard()
    void fit()
  },
  { deep: true },
)

onMounted(async () => {
  if (!hostEl.value) {
    return
  }
  refreshResolvedTheme()
  terminal = new Terminal({
    cursorBlink: props.cursorBlink,
    fontFamily: props.fontFamily,
    fontSize: props.fontSize,
    fontWeight: props.fontWeight,
    fontWeightBold: props.fontWeightBold,
    lineHeight: TERMINAL_LINE_HEIGHT,
    allowTransparency: resolveAllowTransparency(),
    drawBoldTextInBrightColors: true,
    scrollback: props.scrollback,
    convertEol: props.convertEol,
    rightClickSelectsWord: true,
    theme: buildXtermTheme(),
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(hostEl.value)
  terminal.onData((data: string) => {
    if (props.inputEnabled) {
      emit('data', data)
    }
  })
  terminal.onSelectionChange(() => {
    syncSelectionState()
  })
  attachShortcuts()
  await nextTick()
  attachWheelGuard()
  terminalReady.value = true
  await fit()
  emit('ready')

  resizeObserver = new ResizeObserver(() => {
    void fit()
  })
  resizeObserver.observe(hostEl.value)

  themeObserver = new MutationObserver(() => {
    if (props.themeMode === 'auto') {
      refreshResolvedTheme()
    }
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-rs-theme'],
  })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
  resizeObserver?.disconnect()
  resizeObserver = null
  detachWheelGuard?.()
  detachWheelGuard = null
  terminal?.dispose()
  terminal = null
  fitAddon = null
})

defineExpose({
  write,
  clear,
  focus,
  fit,
  copySelection,
  pasteFromClipboard,
  selectAll,
  getTerminal: () => terminal,
})
</script>

<template>
  <RsContextMenu
    :disabled="!contextMenu"
    :items="contextMenuItems"
    @select="onContextMenuSelect"
  >
    <div class="rs-terminal-shell">
      <section
        class="rs-terminal"
        :class="{ 'rs-terminal--zebra': zebraStripes }"
        :style="zebraStyle"
        @click="focus"
        @contextmenu.capture="onTerminalContextMenu"
      >
        <div ref="hostEl" class="rs-terminal__host" />
        <RsLoading v-if="showLoading" class="rs-terminal__loading" />
        <output v-if="overlay" class="rs-terminal__overlay">
          {{ overlay }}
        </output>
      </section>
    </div>
  </RsContextMenu>
</template>

<style scoped>
.rs-terminal-shell {
  display: block;
  height: 100%;
  min-height: 0;
}

.rs-terminal {
  position: relative;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--rs-terminal-border);
  border-radius: var(--rs-radius-md);
  background: var(--rs-terminal-shell-bg, var(--rs-terminal-bg));
  color: var(--rs-terminal-fg);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rs-terminal-fg) 5%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--rs-terminal-fg) 4%, transparent),
    0 1px 3px color-mix(in srgb, #000 32%, transparent);
  overflow: hidden;
}

[data-rs-theme='light'] .rs-terminal {
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 80%, transparent),
    inset 0 0 0 1px color-mix(in srgb, #000 4%, transparent),
    0 1px 4px color-mix(in srgb, #000 8%, transparent);
}

.rs-terminal__host {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.rs-terminal__loading,
.rs-terminal__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rs-terminal__overlay {
  padding: var(--rs-space-lg);
  color: color-mix(in srgb, var(--rs-terminal-fg) 92%, #fff 8%);
  background: color-mix(in srgb, var(--rs-terminal-bg) 84%, transparent);
  text-align: center;
  pointer-events: none;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
  font-weight: 400;
  line-height: var(--rs-line-height-normal);
}

.rs-terminal :deep(.xterm) {
  height: 100%;
}

.rs-terminal--zebra :deep(.xterm) {
  font-size: var(--rs-terminal-font-size, 13px);
  line-height: var(--rs-terminal-line-height, 1.2);
}

.rs-terminal--zebra :deep(.xterm-viewport),
.rs-terminal--zebra :deep(.xterm-rows),
.rs-terminal--zebra :deep(.xterm-rows > div) {
  background-color: transparent !important;
}

/* 条纹画在滚动坐标系内，随 scrollback 自然对齐，无需 JS 追 offset */
.rs-terminal--zebra :deep(.xterm-screen) {
  background-color: transparent !important;
  background-image: repeating-linear-gradient(
    to bottom,
    var(--rs-terminal-bg) 0,
    var(--rs-terminal-bg) var(--rs-terminal-zebra-step, 1lh),
    var(--rs-terminal-row-stripe) var(--rs-terminal-zebra-step, 1lh),
    var(--rs-terminal-row-stripe) calc(var(--rs-terminal-zebra-step, 1lh) * 2)
  );
}

.rs-terminal :deep(.xterm-fg-257) {
  color: var(--rs-terminal-bg) !important;
}

.rs-terminal :deep(.xterm-bg-257) {
  background-color: var(--rs-terminal-fg) !important;
}

.rs-terminal :deep(.xterm-viewport) {
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--rs-terminal-fg) 28%, transparent) transparent;
}
</style>
