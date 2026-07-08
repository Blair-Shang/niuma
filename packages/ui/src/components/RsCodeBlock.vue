<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { useRsI18n } from '../composables/useRsI18n'
import { isCodeMirrorLightTheme, resolveCodeMirrorLanguage } from './code-mirror-lang'

const props = withDefaults(
  defineProps<{
    code: string
    lang?: string
    /** 覆盖内置"复制"文案 */
    copyLabel?: string
    /** 覆盖内置"已复制"文案 */
    copiedLabel?: string
    /** 提供时显示下载按钮，值为建议文件名 */
    downloadFilename?: string
    /** 覆盖内置"下载"文案 */
    downloadLabel?: string
  }>(),
  { lang: 'text' },
)

const { t } = useRsI18n()

const editorEl = ref<HTMLElement | null>(null)
const view = shallowRef<EditorView | null>(null)
const isCopied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null
let themeObserver: MutationObserver | null = null
/** 标记当前是否已卸载，防止异步初始化的竞态条件。 */
let unmounted = false

// ── 主题检测 ────────────────────────────────────────────────────────────────

function isLight(): boolean {
  return isCodeMirrorLightTheme()
}

async function resolveLanguageExtension(lang: string) {
  return resolveCodeMirrorLanguage(lang)
}

// ── 编辑器初始化 ─────────────────────────────────────────────────────────────

async function initEditor() {
  if (!editorEl.value || unmounted) return
  // 保留对当前容器的引用，以防 await 期间 editorEl 变化
  const targetEl = editorEl.value

  view.value?.destroy()
  view.value = null

  const langExts = await resolveLanguageExtension(props.lang ?? '')

  // 异步返回后再次校验：组件可能已卸载或容器已换
  if (unmounted || !targetEl.isConnected) return

  const state = EditorState.create({
    doc: props.code,
    extensions: [
      basicSetup,
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      ...langExts,
      ...(isLight() ? [] : [oneDark]),
    ],
  })

  view.value = new EditorView({ state, parent: targetEl })
}

onMounted(() => {
  unmounted = false
  void initEditor()

  // 监听文档主题切换（data-rs-theme 属性变化），重新初始化以切换配色方案
  themeObserver = new MutationObserver(() => {
    void initEditor()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-rs-theme'],
  })
})

onUnmounted(() => {
  unmounted = true
  view.value?.destroy()
  view.value = null
  themeObserver?.disconnect()
  themeObserver = null
  if (copyTimer !== null) {
    clearTimeout(copyTimer)
    copyTimer = null
  }
})

// lang 变化时重新初始化（切换语言高亮）
watch(() => props.lang, () => { void initEditor() })

// 代码内容更新时同步文档（不需要重建整个编辑器）
watch(
  () => props.code,
  (newCode) => {
    if (!view.value) return
    const current = view.value.state.doc.toString()
    if (current === newCode) return
    view.value.dispatch({
      changes: { from: 0, to: view.value.state.doc.length, insert: newCode },
    })
  },
)

// ── 复制 ────────────────────────────────────────────────────────────────────

async function copy() {
  try {
    await navigator.clipboard.writeText(props.code)
    isCopied.value = true
    if (copyTimer !== null) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      isCopied.value = false
      copyTimer = null
    }, 1500)
  } catch {
    // clipboard 不可用时静默失败
  }
}

function download() {
  if (!props.downloadFilename) return
  const name = props.downloadFilename.replace(/^.*[/\\]/, '') || 'download.html'
  const lower = name.toLowerCase()
  const mime = lower.endsWith('.html') || lower.endsWith('.htm')
    ? 'text/html;charset=utf-8'
    : 'text/plain;charset=utf-8'
  const blob = new Blob([props.code], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <figure class="rs-code-block">
    <figcaption class="rs-code-block__bar">
      <span class="rs-code-block__lang">{{ lang }}</span>
      <div class="rs-code-block__actions">
        <button
          v-if="downloadFilename"
          type="button"
          class="rs-code-block__copy"
          @click="download"
        >
          {{ downloadLabel ?? t('codeBlock.download') }}
        </button>
        <button type="button" class="rs-code-block__copy" @click="copy">
          {{ isCopied ? (copiedLabel ?? t('codeBlock.copied')) : (copyLabel ?? t('codeBlock.copy')) }}
        </button>
      </div>
    </figcaption>
    <div ref="editorEl" class="rs-code-block__editor" />
  </figure>
</template>

<style scoped>
.rs-code-block {
  margin: 0;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius);
  overflow: hidden;
  background: var(--rs-surface-elevated);
  font-size: var(--rs-font-size-sm);
}

.rs-code-block__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--rs-space-xs) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-surface-elevated) 80%, var(--rs-border) 20%);
}

.rs-code-block__lang {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  text-transform: lowercase;
}

.rs-code-block__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
}

.rs-code-block__copy {
  padding: 2px var(--rs-space-sm);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
  transition: color 120ms, border-color 120ms, background 120ms;
}

.rs-code-block__copy:hover {
  color: var(--rs-text);
  border-color: var(--rs-border);
  background: var(--rs-item-hover);
}

/* CodeMirror 编辑器区域：覆盖默认样式以融入设计系统 */
.rs-code-block__editor :deep(.cm-editor) {
  background: var(--rs-surface-elevated) !important;
  /* 最大高度限制，超出时内部滚动 */
  max-height: 32rem;
  overflow-y: auto;
}

/* 浅色模式：代码区用深色文字 */
.rs-code-block__editor :deep(.cm-content) {
  color: var(--rs-foreground);
}

/* 行号区域背景与主体一致 */
.rs-code-block__editor :deep(.cm-gutters) {
  background: color-mix(in srgb, var(--rs-surface-elevated) 85%, var(--rs-border) 15%) !important;
  border-right-color: var(--rs-border-subtle) !important;
  color: var(--rs-muted);
}

/* 激活行高亮跟随设计系统 */
.rs-code-block__editor :deep(.cm-activeLine) {
  background: color-mix(in srgb, var(--rs-primary) 4%, transparent) !important;
}

.rs-code-block__editor :deep(.cm-activeLineGutter) {
  background: color-mix(in srgb, var(--rs-primary) 6%, transparent) !important;
}

.rs-code-block__editor :deep(.cm-scroller) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: var(--rs-font-size-sm);
  line-height: 1.6;
}

/* 只读时隐藏光标，保持纯展示外观 */
.rs-code-block__editor :deep(.cm-cursor) {
  display: none;
}

/* 去掉 CodeMirror 默认焦点描边，统一为 macOS 风格聚焦环 */
.rs-code-block__editor :deep(.cm-editor.cm-focused) {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

/* 选中区跟随设计系统主色 */
.rs-code-block__editor :deep(.cm-selectionBackground) {
  background: color-mix(in srgb, var(--rs-primary) 22%, transparent) !important;
}

.rs-code-block__editor :deep(.cm-focused .cm-selectionBackground) {
  background: color-mix(in srgb, var(--rs-primary) 28%, transparent) !important;
}
</style>
