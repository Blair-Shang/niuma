<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  RsButton,
  RsTerminal,
  buildAnsiColorDemo,
  terminalShortcutLabel,
  type RsTerminalAction,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const terminalRef = ref<InstanceType<typeof RsTerminal> | null>(null)
const loading = ref(false)
const overlay = ref('')
const contextMenu = ref(true)
const shortcuts = ref(true)
const zebraStripes = ref(true)
const lastInput = ref('')
const actionLog = ref<string[]>([])

const geometryText = ref('80 x 24')
const overlayLabel = computed(() => (overlay.value ? '隐藏提示层' : '显示提示层'))
const shortcutHints = computed(() =>
  ['C', 'V', 'A', 'K'].map((key) => terminalShortcutLabel(key)).join(' · '),
)

function pushAction(action: RsTerminalAction): void {
  const stamp = new Date().toLocaleTimeString()
  actionLog.value = [`[${stamp}] ${action}`, ...actionLog.value].slice(0, 8)
}

function writeWelcome(): void {
  terminalRef.value?.write(
    '\x1b[1;36mNiuMa Terminal\x1b[0m — macOS / VS Code inspired palette\r\n$ echo "hello world"\r\nhello world\r\n',
  )
}

function writeColors(): void {
  terminalRef.value?.write(buildAnsiColorDemo())
}

function writeError(): void {
  terminalRef.value?.write(
    '\x1b[31mERR\x1b[0m connection failed: \x1b[1;33mECONNREFUSED\x1b[0m\r\n\x1b[90mhint: check host, port and firewall\x1b[0m\r\n',
  )
}

function writeMultilineLog(): void {
  const lines = Array.from({ length: 24 }, (_, index) => {
    const level = index % 3 === 0 ? 'INFO' : index % 3 === 1 ? 'WARN' : 'DEBUG'
    const color = index % 3 === 0 ? '32' : index % 3 === 1 ? '33' : '90'
    return `\x1b[${color}m[${level}]\x1b[0m line ${String(index + 1).padStart(2, '0')} — zebra stripes improve scanability on long output`
  })
  terminalRef.value?.write(`${lines.join('\r\n')}\r\n`)
}

function clearTerminal(): void {
  terminalRef.value?.clear()
}

function toggleOverlay(): void {
  overlay.value = overlay.value ? '' : '当前为演示提示层，可用于显示连接中、错误或会话结束状态。'
}

function onData(data: string): void {
  lastInput.value = JSON.stringify(data)
  if (data === '\r') {
    terminalRef.value?.write('\r\n$ ')
    return
  }
  terminalRef.value?.write(data)
}

function onResize(payload: { cols: number; rows: number }): void {
  geometryText.value = `${payload.cols} x ${payload.rows}`
}

function onAction(action: RsTerminalAction): void {
  pushAction(action)
}
</script>

<template>
  <DemoPage title="RsTerminal" test-file="RsTerminal.spec.ts">
    <DemoBlock title="主题与多彩输出">
      <p class="hint">
        终端默认 <code>themeMode="auto"</code>，跟随 Playground 顶栏的 Light / Dark 切换；调色板参考 VS Code
        Terminal，外壳圆角与阴影贴近 macOS 风格。默认开启奇数行斑马纹（<code>zebraStripes</code>），长日志更易扫读。
      </p>
      <div class="actions">
        <RsButton variant="secondary" @click="writeWelcome">写入欢迎文本</RsButton>
        <RsButton variant="secondary" @click="writeColors">ANSI 多彩演示</RsButton>
        <RsButton variant="secondary" @click="writeMultilineLog">多行日志演示</RsButton>
        <RsButton variant="secondary" @click="writeError">写入错误样式</RsButton>
        <RsButton variant="secondary" @click="zebraStripes = !zebraStripes">
          {{ zebraStripes ? '关闭斑马纹' : '开启斑马纹' }}
        </RsButton>
        <RsButton variant="secondary" @click="toggleOverlay">{{ overlayLabel }}</RsButton>
        <RsButton variant="secondary" @click="loading = !loading">
          {{ loading ? '关闭 Loading' : '显示 Loading' }}
        </RsButton>
        <RsButton variant="ghost" @click="clearTerminal">清空</RsButton>
      </div>
      <div class="terminal-wrap">
        <RsTerminal
          ref="terminalRef"
          :loading="loading"
          :overlay="overlay"
          :context-menu="contextMenu"
          :shortcuts="shortcuts"
          :zebra-stripes="zebraStripes"
          @data="onData"
          @resize="onResize"
          @action="onAction"
        />
      </div>
      <p class="meta">当前几何：<code>{{ geometryText }}</code></p>
      <p class="meta">最近输入：<code>{{ lastInput || '(无)' }}</code></p>
    </DemoBlock>

    <DemoBlock title="快捷键与右键菜单">
      <p class="hint">
        在终端内聚焦后可用快捷键：<code>{{ shortcutHints }}</code>（复制需先选中文字）。右键打开 macOS 风格菜单，含图标与快捷键提示。
      </p>
      <div class="actions">
        <RsButton
          variant="secondary"
          @click="contextMenu = !contextMenu"
        >
          {{ contextMenu ? '禁用右键菜单' : '启用右键菜单' }}
        </RsButton>
        <RsButton
          variant="secondary"
          @click="shortcuts = !shortcuts"
        >
          {{ shortcuts ? '禁用快捷键' : '启用快捷键' }}
        </RsButton>
        <RsButton variant="secondary" @click="terminalRef?.selectAll()">全选</RsButton>
        <RsButton variant="secondary" @click="terminalRef?.copySelection()">复制选区</RsButton>
        <RsButton variant="secondary" @click="terminalRef?.pasteFromClipboard()">粘贴</RsButton>
      </div>
      <ul v-if="actionLog.length" class="log">
        <li v-for="(line, index) in actionLog" :key="`${line}-${index}`">{{ line }}</li>
      </ul>
      <p v-else class="meta">操作日志：在终端内使用右键或快捷键后会显示 copy / paste / selectAll / clear。</p>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: var(--rs-line-height-normal);
}

.hint code,
.meta code {
  color: var(--rs-text);
  font-size: 0.92em;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-sm);
}

.terminal-wrap {
  height: 24rem;
  border-radius: var(--rs-radius-md);
  overflow: hidden;
}

.meta {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.log {
  margin: 0;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-bg);
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  list-style: none;
}

.log li + li {
  margin-top: var(--rs-space-xs);
}
</style>
