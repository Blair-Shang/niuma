<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, keymap, placeholder } from '@codemirror/view'

const model = defineModel<string>({ default: '' })

const props = withDefaults(
  defineProps<{
    readonly?: boolean
    placeholder?: string
    minHeight?: string
  }>(),
  {
    readonly: false,
    placeholder: '',
    minHeight: '12rem',
  },
)

const emit = defineEmits<{
  selectionChange: [{ start: number; end: number }]
}>()

const rootEl = ref<HTMLElement | null>(null)
const view = shallowRef<EditorView | null>(null)
let unmounted = false

function buildExtensions() {
  const exts = [
    history(),
    drawSelection(),
    dropCursor(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !props.readonly) {
        const next = update.state.doc.toString()
        if (next !== model.value) {
          model.value = next
        }
      }
      if (update.selectionSet) {
        const { from, to } = update.state.selection.main
        emit('selectionChange', { start: from, end: to })
      }
    }),
    EditorView.editable.of(!props.readonly),
    EditorView.theme({
      '&': { height: '100%', backgroundColor: 'transparent' },
      '.cm-scroller': {
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', Georgia, serif",
        fontSize: '1.05rem',
        lineHeight: '1.9',
        letterSpacing: '0.02em',
      },
      '.cm-content': {
        padding: '0.75rem 1rem',
        caretColor: 'var(--rs-primary)',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-cursor': { borderLeftColor: 'var(--rs-primary)' },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: 'color-mix(in srgb, var(--rs-primary) 18%, transparent) !important',
      },
    }),
  ]
  if (props.placeholder) {
    exts.push(placeholder(props.placeholder))
  }
  return exts
}

function initEditor() {
  if (!rootEl.value || unmounted) return
  view.value?.destroy()
  const state = EditorState.create({
    doc: model.value,
    extensions: buildExtensions(),
  })
  view.value = new EditorView({ state, parent: rootEl.value })
}

function syncDocFromOutside(val: string) {
  const v = view.value
  if (!v) return
  const cur = v.state.doc.toString()
  if (cur === val) return
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: val } })
}

function getSelection() {
  const v = view.value
  if (!v) return { start: 0, end: 0 }
  const { from, to } = v.state.selection.main
  return { start: from, end: to }
}

function focus() {
  view.value?.focus()
}

defineExpose({ getSelection, focus, view })

onMounted(() => {
  unmounted = false
  initEditor()
})

onUnmounted(() => {
  unmounted = true
  view.value?.destroy()
  view.value = null
})

watch(
  () => model.value,
  (val) => syncDocFromOutside(val ?? ''),
)

watch(
  () => props.readonly,
  () => initEditor(),
)
</script>

<template>
  <div
    class="rs-prose-editor"
    :class="{ 'rs-prose-editor--readonly': readonly }"
    :style="{ minHeight }"
  >
    <div ref="rootEl" class="rs-prose-editor__cm" />
  </div>
</template>

<style scoped>
.rs-prose-editor {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.rs-prose-editor__cm {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.rs-prose-editor__cm :deep(.cm-editor) {
  height: 100%;
}

.rs-prose-editor--readonly {
  opacity: 0.72;
}
</style>
