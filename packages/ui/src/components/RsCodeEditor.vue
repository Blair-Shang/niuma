<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import type {
  RsCodeEditorDiagnostic,
  RsCodeEditorLanguage,
  RsCodeEditorSqlConfig,
  RsCodeEditorTheme,
} from './code-editor-utils'
import {
  codeEditorLanguageLabel,
  resolveCodeEditorLanguage,
  resolveCodeEditorSize,
  resolveCodeEditorTheme,
} from './code-editor-utils'
import { isCodeMirrorLightTheme, resolveCodeMirrorLanguage } from './code-mirror-lang'
import {
  diagnosticExtensions,
  setEditorDiagnostics,
} from './code-mirror-diagnostics'
import { codeMirrorIntelExtensions, goToPosition } from './code-mirror-intel'
import { codeMirrorCompletionExtensions } from './code-mirror-completion'
import { codeMirrorGhostExtensions, clearGhostCompletion } from './code-mirror-ghost'
import {
  codeMirrorInlineEditExtension,
  extractSurroundingContext,
  replaceEditorRange,
  type InlineEditTrigger,
} from './code-mirror-inline-edit'

const model = defineModel<string>({ default: '' })

const emit = defineEmits<{
  'goto-definition': [loc: { file: string; line: number; column?: number }]
  ready: []
}>()

const props = withDefaults(
  defineProps<{
    language?: RsCodeEditorLanguage
    theme?: RsCodeEditorTheme
    height?: number | string
    readonly?: boolean
    disabled?: boolean
    /** 是否显示内置语言标签栏（文件工作台使用外部 FileEditorToolbar 时应关闭） */
    showToolbar?: boolean
    diagnostics?: RsCodeEditorDiagnostic[]
    placeholder?: string
    /** SQL 表/字段补全（language=sql 时生效） */
    sqlConfig?: RsCodeEditorSqlConfig
    filePath?: string
    hoverRequest?: (line: number, column: number) => Promise<string | null>
    definitionRequest?: (line: number, column: number) => Promise<{
      file: string
      line: number
      column?: number
    } | null>
    completionRequest?: (prefix: string, suffix: string, line: number, column: number) => Promise<string | null>
    inlineEditRequest?: (params: {
      selection: string
      instruction: string
      from: number
      to: number
      surroundingContext: string
    }) => Promise<string | null>
  }>(),
  {
    language: 'plaintext',
    theme: 'auto',
    readonly: false,
    disabled: false,
    showToolbar: true,
    diagnostics: () => [],
  },
)

const resolvedLanguage = computed(() => resolveCodeEditorLanguage(props.language))
const resolvedLanguageLabel = computed(() => codeEditorLanguageLabel(props.language))
const resolvedTheme = computed(() => resolveCodeEditorTheme(props.theme))

const editorEl = ref<HTMLElement | null>(null)
const view = shallowRef<EditorView | null>(null)
const editableCompartment = new Compartment()
let themeObserver: MutationObserver | null = null
let unmounted = false
let syncingFromModel = false
let ghostTimer: ReturnType<typeof setTimeout> | null = null
let initSeq = 0
const inlineEditOpen = ref(false)
const inlineEditInstruction = ref('')
const inlineEditLoading = ref(false)
const inlineEditPreview = ref('')
const inlineEditError = ref('')
const inlineEditInputRef = ref<HTMLInputElement | null>(null)
let pendingInlineEdit: InlineEditTrigger | null = null

function closeInlineEdit() {
  inlineEditOpen.value = false
  inlineEditInstruction.value = ''
  inlineEditPreview.value = ''
  inlineEditError.value = ''
  pendingInlineEdit = null
}

function onInlineEditTrigger(_view: EditorView, info: InlineEditTrigger) {
  if (!props.inlineEditRequest || props.readonly || props.disabled) return
  if (view.value) clearGhostCompletion(view.value)
  pendingInlineEdit = info
  inlineEditPreview.value = info.selection.length > 120
    ? `${info.selection.slice(0, 120)}…`
    : info.selection
  inlineEditOpen.value = true
  inlineEditInstruction.value = ''
  inlineEditError.value = ''
  void nextTick(() => inlineEditInputRef.value?.focus())
}

async function submitInlineEdit() {
  const range = pendingInlineEdit
  const instruction = inlineEditInstruction.value.trim()
  if (!range || !instruction || !props.inlineEditRequest || !view.value || inlineEditLoading.value) return
  inlineEditLoading.value = true
  inlineEditError.value = ''
  try {
    const doc = view.value.state.doc.toString()
    const edited = await props.inlineEditRequest({
      selection: range.selection,
      instruction,
      from: range.from,
      to: range.to,
      surroundingContext: extractSurroundingContext(doc, range.from, range.to),
    })
    if (edited == null) {
      inlineEditError.value = '未能生成替换代码，请调整指令后重试'
      return
    }
    replaceEditorRange(view.value, range.from, range.to, edited)
    closeInlineEdit()
  } finally {
    inlineEditLoading.value = false
  }
}

function scheduleGhostCompletion(fn: () => void) {
  if (ghostTimer) clearTimeout(ghostTimer)
  ghostTimer = setTimeout(fn, 900)
}

function cancelGhostCompletionSchedule() {
  if (ghostTimer) {
    clearTimeout(ghostTimer)
    ghostTimer = null
  }
}

async function initEditor() {
  if (!editorEl.value || unmounted) return
  const seq = ++initSeq
  const targetEl = editorEl.value

  view.value?.destroy()
  view.value = null

  const langExts = await resolveCodeMirrorLanguage(resolvedLanguage.value, {
    sql: props.sqlConfig,
  })
  if (unmounted || !targetEl.isConnected || seq !== initSeq) return

  const editable = !props.readonly && !props.disabled
  const state = EditorState.create({
    doc: model.value,
    extensions: [
      basicSetup,
      EditorView.lineWrapping,
      editableCompartment.of(EditorView.editable.of(editable)),
      ...(props.placeholder ? [cmPlaceholder(props.placeholder)] : []),
      ...langExts,
      diagnosticExtensions(),
      ...codeMirrorIntelExtensions(() => ({
        hoverRequest: props.hoverRequest,
        definitionRequest: props.definitionRequest,
        currentFilePath: props.filePath,
        onGotoDefinition: (loc) => emit('goto-definition', loc),
      })),
      ...codeMirrorCompletionExtensions(() => ({
        completionRequest: props.completionRequest,
      })),
      ...codeMirrorGhostExtensions(
        () => ({ completionRequest: props.completionRequest }),
        scheduleGhostCompletion,
        cancelGhostCompletionSchedule,
      ),
      ...(props.inlineEditRequest
        ? [codeMirrorInlineEditExtension(onInlineEditTrigger)]
        : []),
      ...(isCodeMirrorLightTheme() ? [] : [oneDark]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || syncingFromModel) return
        const next = update.state.doc.toString()
        if (next !== model.value) model.value = next
      }),
    ],
  })

  view.value = new EditorView({ state, parent: targetEl })
  setEditorDiagnostics(view.value, props.diagnostics ?? [])
  emit('ready')
}

onMounted(() => {
  unmounted = false
  void initEditor()
  themeObserver = new MutationObserver(() => { void initEditor() })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-rs-theme'],
  })
})

onUnmounted(() => {
  unmounted = true
  if (ghostTimer) clearTimeout(ghostTimer)
  view.value?.destroy()
  view.value = null
  themeObserver?.disconnect()
  themeObserver = null
})

watch(() => props.language, () => { void initEditor() })
watch(() => props.inlineEditRequest, () => { void initEditor() })
watch(
  () => props.sqlConfig,
  () => {
    if (resolvedLanguage.value === 'sql') void initEditor()
  },
  { deep: true },
)

watch(
  () => model.value,
  (newCode) => {
    if (!view.value) return
    const current = view.value.state.doc.toString()
    if (current === newCode) return
    syncingFromModel = true
    if (view.value) clearGhostCompletion(view.value)
    view.value.dispatch({
      changes: { from: 0, to: view.value.state.doc.length, insert: newCode },
    })
    syncingFromModel = false
  },
)

watch(
  () => [props.readonly, props.disabled] as const,
  ([readonly, disabled]) => {
    if (!view.value) return
    const editable = !readonly && !disabled
    view.value.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(editable)),
    })
  },
)

watch(
  () => props.diagnostics,
  (diags) => {
    if (!view.value) return
    setEditorDiagnostics(view.value, diags ?? [])
  },
  { deep: true },
)

defineExpose({
  goToPosition(line: number, column = 1) {
    if (!view.value) return
    goToPosition(view.value, line, column)
  },
})
</script>

<template>
  <div
    class="rs-code-editor"
    :class="`rs-code-editor--${resolvedTheme}`"
    :style="{ height: resolveCodeEditorSize(height) }"
  >
    <div v-if="showToolbar" class="rs-code-editor__toolbar">
      <span>{{ resolvedLanguageLabel }}</span>
      <slot name="toolbar" />
    </div>
    <div class="rs-code-editor__body">
      <div
        ref="editorEl"
        class="rs-code-editor__surface"
        :class="{ 'rs-code-editor__surface--disabled': disabled }"
      />
      <div v-if="inlineEditOpen" class="rs-code-editor__inline-edit">
        <div class="rs-code-editor__inline-edit-head">
          <span>Inline Edit</span>
          <kbd>Ctrl+K</kbd>
        </div>
        <p class="rs-code-editor__inline-preview">{{ inlineEditPreview }}</p>
        <input
          ref="inlineEditInputRef"
          v-model="inlineEditInstruction"
          class="rs-code-editor__inline-input"
          type="text"
          placeholder="描述要如何修改选区…"
          :disabled="inlineEditLoading"
          @keydown.enter.prevent="submitInlineEdit"
          @keydown.esc.prevent="closeInlineEdit"
        />
        <p v-if="inlineEditError" class="rs-code-editor__inline-error">{{ inlineEditError }}</p>
        <div class="rs-code-editor__inline-actions">
          <button type="button" class="rs-code-editor__inline-btn" :disabled="inlineEditLoading" @click="closeInlineEdit">
            取消
          </button>
          <button
            type="button"
            class="rs-code-editor__inline-btn rs-code-editor__inline-btn--primary"
            :disabled="inlineEditLoading || !inlineEditInstruction.trim()"
            @click="submitInlineEdit"
          >
            {{ inlineEditLoading ? '生成中…' : '应用' }}
          </button>
        </div>
      </div>
    </div>
    <ul v-if="diagnostics.length" class="rs-code-editor__diagnostics">
      <li
        v-for="(diagnostic, index) in diagnostics"
        :key="index"
        :class="`rs-code-editor__diagnostic--${diagnostic.severity ?? 'error'}`"
      >
        <span v-if="diagnostic.line">{{ diagnostic.line }}:{{ diagnostic.column ?? 1 }}</span>
        {{ diagnostic.message }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.rs-code-editor {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-input-bg);
  color: var(--rs-text);
}
.rs-code-editor__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--rs-space-xs) var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}
.rs-code-editor__body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.rs-code-editor__surface {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.rs-code-editor__inline-edit {
  position: absolute;
  left: 50%;
  top: 12%;
  z-index: 5;
  width: min(28rem, calc(100% - 2rem));
  transform: translateX(-50%);
  padding: 0.75rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface-elevated);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
}
.rs-code-editor__inline-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-foreground);
}
.rs-code-editor__inline-edit-head kbd {
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  border: 1px solid var(--rs-border-subtle);
  font-size: 0.7rem;
  color: var(--rs-muted);
}
.rs-code-editor__inline-preview {
  margin: 0 0 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  background: color-mix(in srgb, var(--rs-muted) 8%, transparent);
  color: var(--rs-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.72rem;
  line-height: 1.4;
  white-space: pre-wrap;
  max-height: 4.5rem;
  overflow: hidden;
}
.rs-code-editor__inline-input {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 0.5rem;
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm, 4px);
  background: var(--rs-input-bg);
  color: var(--rs-foreground);
  font-size: var(--rs-font-size-sm);
}
.rs-code-editor__inline-input:focus {
  outline: 2px solid color-mix(in srgb, var(--rs-primary) 35%, transparent);
  outline-offset: 1px;
}
.rs-code-editor__inline-error {
  margin: -0.25rem 0 0.5rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-danger);
}
.rs-code-editor__inline-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.35rem;
}
.rs-code-editor__inline-btn {
  padding: 0.3rem 0.65rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm, 4px);
  background: transparent;
  color: var(--rs-foreground);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
}
.rs-code-editor__inline-btn--primary {
  border-color: var(--rs-primary);
  background: var(--rs-primary);
  color: var(--rs-primary-foreground, #fff);
}
.rs-code-editor__inline-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.rs-code-editor__surface--disabled {
  opacity: 0.6;
  pointer-events: none;
}
.rs-code-editor__surface :deep(.cm-editor) {
  height: 100%;
  background: var(--rs-surface-elevated) !important;
}
.rs-code-editor__surface :deep(.cm-scroller) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: var(--rs-font-size-sm);
  line-height: 1.6;
}
.rs-code-editor__surface :deep(.cm-gutters) {
  background: color-mix(in srgb, var(--rs-surface-elevated) 85%, var(--rs-border) 15%) !important;
  border-right-color: var(--rs-border-subtle) !important;
  color: var(--rs-muted);
}
.rs-code-editor__surface :deep(.cm-content) {
  color: var(--rs-foreground);
}
.rs-code-editor__surface :deep(.cm-lintRange-error) {
  background: color-mix(in srgb, var(--rs-danger) 12%, transparent);
}
.rs-code-editor__surface :deep(.cm-lintRange-warning) {
  background: color-mix(in srgb, var(--rs-warning) 12%, transparent);
}
.rs-code-editor__surface :deep(.cm-lintRange-info) {
  background: color-mix(in srgb, var(--rs-info) 10%, transparent);
}
.rs-code-editor__surface :deep(.rs-code-editor__ghost) {
  color: var(--rs-muted);
  opacity: 0.55;
  pointer-events: none;
}
.rs-code-editor__surface :deep(.rs-code-editor__hover) {
  max-width: 28rem;
  padding: 0.45rem 0.65rem;
  border-radius: var(--rs-radius-sm, 4px);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-elevated);
  color: var(--rs-foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: var(--rs-font-size-xs);
  line-height: 1.45;
  white-space: pre-wrap;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}
.rs-code-editor__diagnostics {
  margin: 0;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-top: 1px solid var(--rs-border-subtle);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  list-style: none;
}
.rs-code-editor__diagnostic--error {
  color: var(--rs-danger);
}
.rs-code-editor__diagnostic--warning {
  color: var(--rs-warning);
}
.rs-code-editor__diagnostic--info {
  color: var(--rs-info);
}
</style>
