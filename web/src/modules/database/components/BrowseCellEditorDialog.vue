<script setup lang="ts">
/**
 * 浏览 / 查询结果大字段弹窗：
 * - 每个宿主最多挂载一个 RsCodeEditor；关闭后停放复用
 * - CodeMirror 使用 RsCodeEditor 公共样式，不做视觉覆盖
 * - 「应用」写回 staged，行首 ✓ 再提交数据库
 * - 未传入的文案走 modules.database 多语言
 */
import {
  isNullDraft,
  nullToEditText,
  RsButton,
  RsCodeEditor,
  RsDialog,
  type RsCodeEditorLanguage,
} from '@niuma/ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

type BrowseEditorMode = 'plaintext' | 'json' | 'xml'

const open = defineModel<boolean>('open', { default: false })
const draft = defineModel<string>('draft', { default: '' })

const props = withDefaults(
  defineProps<{
    title?: string
    /** 只读查看（二进制等） */
    readonly?: boolean
    applyLabel?: string
    cancelLabel?: string
    /** 显示「复制全文」 */
    showCopyFull?: boolean
    copyFullLabel?: string
    copiedLabel?: string
  }>(),
  {
    title: '',
    readonly: false,
    applyLabel: '',
    cancelLabel: '',
    showCopyFull: false,
    copyFullLabel: '',
    copiedLabel: '',
  },
)

const emit = defineEmits<{
  apply: [value: string]
  cancel: []
  copyFull: []
}>()

const { t } = useI18n()

const modeOptions = computed((): Array<{ id: BrowseEditorMode; label: string }> => [
  { id: 'plaintext', label: t('modules.database.cellEditor.modePlaintext') },
  { id: 'json', label: t('modules.database.cellEditor.modeJson') },
  { id: 'xml', label: t('modules.database.cellEditor.modeXml') },
])

const dialogTitle = computed(
  () => props.title.trim() || t('modules.database.cellEditor.editTitle'),
)
const applyText = computed(
  () => props.applyLabel.trim() || t('modules.database.cellEditor.apply'),
)
const cancelText = computed(
  () => props.cancelLabel.trim() || t('modules.database.cellEditor.cancel'),
)
const copyFullText = computed(
  () => props.copyFullLabel.trim() || t('modules.database.cellEditor.copyFull'),
)
const copiedText = computed(
  () => props.copiedLabel.trim() || t('modules.database.cellEditor.copied'),
)

const copyBusy = ref(false)
const copyDone = ref(false)
let copyDoneTimer: ReturnType<typeof setTimeout> | null = null

/** 表格级单例：首次打开后常驻，关闭不销毁 */
const editorAlive = ref(false)
const editorText = ref('')
const mode = ref<BrowseEditorMode>('plaintext')
const parkHost = ref<HTMLElement | null>(null)
const panelHost = ref<HTMLElement | null>(null)

const language = computed((): RsCodeEditorLanguage => mode.value)

const teleportTo = computed<HTMLElement | null>(() => {
  if (open.value && panelHost.value) return panelHost.value
  return parkHost.value
})

function toEditorText(value: string): string {
  return isNullDraft(value) ? '' : value
}

function toDraftText(value: string): string {
  if (value === '') return nullToEditText()
  return value
}

function detectMode(text: string): BrowseEditorMode {
  const t0 = text.trim()
  if (!t0) return 'plaintext'
  if (
    (t0.startsWith('{') && t0.endsWith('}')) ||
    (t0.startsWith('[') && t0.endsWith(']'))
  ) {
    try {
      JSON.parse(t0)
      return 'json'
    } catch {
      /* fallthrough */
    }
  }
  if (t0.startsWith('<') && t0.includes('>')) return 'xml'
  return 'plaintext'
}

function setMode(next: BrowseEditorMode): void {
  mode.value = next
}

watch(open, async (value) => {
  if (!value) {
    // 释放大字段文本，保留 CodeMirror 实例
    editorText.value = ''
    copyDone.value = false
    if (copyDoneTimer) {
      clearTimeout(copyDoneTimer)
      copyDoneTimer = null
    }
    return
  }
  editorAlive.value = true
  const text = toEditorText(draft.value)
  editorText.value = text
  mode.value = detectMode(text)
  await nextTick()
  if (!open.value) return
  // Teleport 到面板后触发一次布局，避免停放时宽高为 0 导致 gutter 异常
  window.dispatchEvent(new Event('resize'))
})

function onCancel(): void {
  open.value = false
  emit('cancel')
}

function onApply(): void {
  if (props.readonly) {
    open.value = false
    return
  }
  const value = toDraftText(editorText.value)
  draft.value = value
  emit('apply', value)
  open.value = false
}

function onCopyFull(): void {
  if (copyBusy.value) return
  copyBusy.value = true
  emit('copyFull')
  copyDone.value = true
  if (copyDoneTimer) clearTimeout(copyDoneTimer)
  copyDoneTimer = setTimeout(() => {
    copyDone.value = false
    copyDoneTimer = null
  }, 1200)
  copyBusy.value = false
}
</script>

<template>
  <!-- 停放宿主：弹窗关闭时编辑器挂在这里，不随 Dialog body 卸载 -->
  <div ref="parkHost" class="nm-browse-cell-editor__park" aria-hidden="true" />

  <RsDialog
    v-model:open="open"
    :title="dialogTitle"
    width="lg"
    layout="window"
    :draggable="true"
    :resizable="true"
    :modal="true"
    :close-on-overlay-click="false"
    :defer-body-mount="false"
  >
    <template #body>
      <div class="nm-browse-cell-editor">
        <div v-if="!readonly" class="nm-browse-cell-editor__modes" role="tablist">
          <button
            v-for="opt in modeOptions"
            :key="opt.id"
            type="button"
            role="tab"
            class="nm-browse-cell-editor__mode"
            :class="{ 'nm-browse-cell-editor__mode--active': mode === opt.id }"
            :aria-selected="mode === opt.id"
            @click="setMode(opt.id)"
          >
            {{ opt.label }}
          </button>
        </div>
        <div ref="panelHost" class="nm-browse-cell-editor__host" />
      </div>
    </template>
    <template #footer>
      <RsButton
        v-if="showCopyFull"
        variant="ghost"
        @click="onCopyFull"
      >
        {{ copyDone ? copiedText : copyFullText }}
      </RsButton>
      <RsButton v-if="!readonly" variant="ghost" @click="onCancel">{{ cancelText }}</RsButton>
      <RsButton v-if="!readonly" variant="primary" @click="onApply">{{ applyText }}</RsButton>
      <RsButton v-else variant="primary" @click="onCancel">{{ cancelText }}</RsButton>
    </template>
  </RsDialog>

  <Teleport v-if="editorAlive && teleportTo" :to="teleportTo">
    <RsCodeEditor
      v-model="editorText"
      class="nm-browse-cell-editor__cm"
      :language="language"
      theme="auto"
      height="100%"
      :show-toolbar="false"
      :fold-gutter="true"
      :readonly="readonly"
      :disabled="readonly"
    />
  </Teleport>
</template>

<style scoped>
/* 仅布局与停放；编辑器外观交给 RsCodeEditor 公共样式 */
.nm-browse-cell-editor__park {
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.nm-browse-cell-editor {
  display: flex;
  flex-direction: column;
  min-height: 18rem;
  height: min(52vh, 30rem);
  gap: 0.5rem;
}

.nm-browse-cell-editor__modes {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 0.125rem;
}

.nm-browse-cell-editor__mode {
  appearance: none;
  margin: 0;
  padding: 0.2rem 0.55rem;
  border: 0;
  border-radius: var(--rs-radius-xs, 4px);
  background: transparent;
  color: var(--rs-muted, var(--rs-text-secondary, #6b7280));
  font: inherit;
  font-size: var(--rs-font-size-xs, 0.75rem);
  line-height: 1.4;
  cursor: pointer;
}

.nm-browse-cell-editor__mode--active {
  background: var(--rs-bg-muted, color-mix(in srgb, var(--rs-border) 12%, transparent));
  color: var(--rs-text);
}

.nm-browse-cell-editor__mode:hover:not(.nm-browse-cell-editor__mode--active) {
  color: var(--rs-text);
}

.nm-browse-cell-editor__host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 落在组件根上的 class（非 :deep），仅控制占满宿主高度 */
.nm-browse-cell-editor__cm {
  flex: 1;
  min-height: 0;
}
</style>
