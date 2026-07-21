<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import type { RsComponentSize } from '../../theme/types'
import { useRsI18n } from '../../composables/useRsI18n'
import RsDatePicker from '../RsDatePicker.vue'
import RsInput from '../RsInput.vue'
import RsSelect from '../RsSelect.vue'
import type { RsSelectOptions } from '../select-utils'
import type { RsTableColumnEditorOptionsResolved, RsTableCellValueType } from '../table-utils'
import {
  applyFocusMode,
  isNullDraft,
  nullToEditText,
  resolveCellEditorInputType,
  usesOverlayEditor,
  type RsTableCellCommitTrigger,
  type RsTableCellEditFocusMode,
  type RsTableCellNavigateDirection,
} from './table-edit-utils'

const { t } = useRsI18n()

const props = withDefaults(
  defineProps<{
    valueType?: RsTableCellValueType
    editorOptions?: RsTableColumnEditorOptionsResolved
    size?: RsComponentSize
    placeholder?: string
    commitOn?: RsTableCellCommitTrigger
    autofocus?: boolean
    /** inline：表格单元格内紧凑编辑；field：Popover/表单场景完整输入框 */
    variant?: 'inline' | 'field'
    focusMode?: RsTableCellEditFocusMode
    allowNull?: boolean
    errorMessage?: string | null
    validating?: boolean
  }>(),
  {
    valueType: 'text',
    size: 'sm',
    commitOn: 'blur',
    autofocus: true,
    variant: 'inline',
    focusMode: 'end',
    allowNull: true,
    errorMessage: null,
    validating: false,
  },
)

const model = defineModel<string>({ default: '' })

const emit = defineEmits<{
  commit: []
  cancel: []
  navigate: [direction: RsTableCellNavigateDirection]
  setNull: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const textareaId = useId()
const textareaLabel = computed(() => props.placeholder || t('table.editTextarea'))
/** 仅 date 浮层：打开时抑制 blur 误提交；select 不做关闭特殊处理 */
const dateOverlayOpen = ref(false)
/** 多选 select：关闭下拉时再提交 */
const selectOverlayOpen = ref(false)
const composing = ref(false)

const inputType = computed(() => resolveCellEditorInputType(props.valueType))
const isSelect = computed(() => props.valueType === 'select')
const isMultipleSelect = computed(
  () => isSelect.value && Boolean(props.editorOptions?.multiple),
)
const isDate = computed(() => props.valueType === 'date' || props.valueType === 'datetime')
const isTextarea = computed(() => props.valueType === 'textarea')
const isTextLike = computed(() => !isSelect.value && !isDate.value && !isTextarea.value)
const isNullValue = computed(() => isNullDraft(model.value))
const resolvedFocusMode = computed(
  (): RsTableCellEditFocusMode => props.editorOptions?.focusMode ?? props.focusMode,
)
const textareaRows = computed(() => props.editorOptions?.rows ?? 3)

const selectOptions = computed((): RsSelectOptions => props.editorOptions?.options ?? [])

/** 多选草稿：逗号分隔字符串 ↔ string[]（与表设计索引列等约定一致） */
function parseMultiSelectDraft(text: string): string[] {
  return String(text ?? '')
    .split(/[,，]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function joinMultiSelectDraft(values: string[]): string {
  return values
    .map((s) => String(s).trim())
    .filter(Boolean)
    .join(', ')
}

const selectModelValue = computed((): string | string[] => {
  if (isNullValue.value) return isMultipleSelect.value ? [] : ''
  if (isMultipleSelect.value) return parseMultiSelectDraft(model.value)
  return model.value
})

watch(selectOverlayOpen, (isOpen, wasOpen) => {
  if (wasOpen && !isOpen && isMultipleSelect.value) emit('commit')
})

const displayModel = computed({
  get: () => (isNullDraft(model.value) ? '' : model.value),
  set: (value: string) => {
    model.value = value
  },
})

async function focusEditor(): Promise<void> {
  await nextTick()
  if (isSelect.value || isDate.value) return
  const el = rootRef.value?.querySelector('input, textarea') as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null
    | undefined
  if (!el) return
  el.focus()
  if (el instanceof HTMLInputElement && (el.type === 'number' || el.type === 'date' || el.type === 'datetime-local')) {
    return
  }
  applyFocusMode(el, resolvedFocusMode.value)
}

onMounted(() => {
  if (props.autofocus) void focusEditor()
})

function shouldCommitOnEnter(): boolean {
  if (isTextarea.value && !composing.value) return false
  return props.commitOn === 'enter' || props.commitOn === 'blur' || props.commitOn === 'manual'
}

function shouldCommitOnBlur(): boolean {
  // select：change 提交，不做关闭/blur 特殊处理
  if (props.valueType === 'select' || props.commitOn === 'change') return false
  // 日期面板打开时不 blur 提交；关闭后也不靠 blur（面板「确认」只改草稿，Enter/Tab 再提交）
  if (isDate.value) return false
  if (usesOverlayEditor(props.valueType)) return false
  return props.commitOn === 'blur' || props.commitOn === 'manual'
}

function shouldCommitOnChange(): boolean {
  return props.commitOn === 'change'
}

function onPressEnter(event: KeyboardEvent): void {
  if (event.isComposing || composing.value) return
  if (isTextarea.value) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      emit('commit')
    }
    return
  }
  event.preventDefault()
  if (shouldCommitOnEnter()) emit('commit')
}

function onBlur(): void {
  if (isDate.value && dateOverlayOpen.value) {
    window.setTimeout(() => {
      if (shouldCommitOnBlur()) emit('commit')
    }, 0)
    return
  }
  if (shouldCommitOnBlur()) emit('commit')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || composing.value) {
    if (event.key === 'Process') return
  }
  if (event.key === 'Enter') {
    onPressEnter(event)
    return
  }
  if (event.key === 'Escape') {
    if (event.isComposing || composing.value) return
    event.preventDefault()
    emit('cancel')
    return
  }
  if (event.key === 'Tab') {
    if (event.isComposing || composing.value) return
    event.preventDefault()
    emit('navigate', event.shiftKey ? 'prev' : 'next')
    return
  }
  if (props.allowNull && event.key === '0' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    model.value = nullToEditText()
    emit('setNull')
    emit('commit')
  }
}

function onSelectUpdate(value: string | string[]): void {
  const empty =
    value == null || value === '' || (Array.isArray(value) && value.length === 0)
  // 表格内下拉默认不可清除：仅选择；显式 clearable 时才允许清空
  if (empty) {
    if (!props.editorOptions?.clearable) return
    model.value = props.allowNull ? nullToEditText() : ''
    // 多选：关闭面板时再提交；单选 clearable 仍走 change
    if (!isMultipleSelect.value && shouldCommitOnChange()) emit('commit')
    return
  }
  if (isMultipleSelect.value) {
    const list = Array.isArray(value) ? value.map(String) : [String(value)]
    model.value = joinMultiSelectDraft(list)
    // 多选不在每次勾选时提交，等下拉关闭
    return
  }
  model.value = Array.isArray(value) ? (value[0] ?? '') : String(value ?? '')
  if (shouldCommitOnChange()) emit('commit')
}

function onDateUpdate(value: string): void {
  model.value = value || (props.allowNull ? nullToEditText() : '')
  // change 模式下等 dateOverlayOpen 关闭再 commit，见上方 watch
}
</script>

<template>
  <div
    ref="rootRef"
    class="rs-table-cell-editor"
    :class="[
      `rs-table-cell-editor--${size}`,
      `rs-table-cell-editor--${valueType}`,
      `rs-table-cell-editor--${variant}`,
      {
        'rs-table-cell-editor--overlay': isSelect || isDate,
        'rs-table-cell-editor--invalid': !!errorMessage,
        'rs-table-cell-editor--null': isNullValue,
        'rs-table-cell-editor--validating': validating,
      },
    ]"
    :title="errorMessage || undefined"
    :aria-invalid="errorMessage ? 'true' : undefined"
    :aria-busy="validating ? 'true' : undefined"
    @click.stop
    @dblclick.stop
  >
    <span v-if="validating" class="rs-table-cell-editor__validating" aria-hidden="true">…</span>
    <span v-else-if="isNullValue && !isSelect && !isDate" class="rs-table-cell-editor__null-tag" aria-hidden="true">
      NULL
    </span>
    <RsSelect
      v-if="isSelect"
      :model-value="selectModelValue"
      v-model:open="selectOverlayOpen"
      :options="selectOptions"
      :size="size"
      block
      :multiple="isMultipleSelect"
      :searchable="editorOptions?.searchable ?? true"
      :creatable="editorOptions?.creatable ?? false"
      :clearable="editorOptions?.clearable ?? false"
      :placeholder="placeholder"
      @update:model-value="onSelectUpdate"
      @keydown="onKeydown"
    />
    <RsDatePicker
      v-else-if="isDate"
      :model-value="isNullValue ? '' : model"
      v-model:open="dateOverlayOpen"
      :with-time="valueType === 'datetime'"
      :with-seconds="editorOptions?.withSeconds ?? valueType === 'datetime'"
      :placeholder="placeholder"
      @update:model-value="(v) => onDateUpdate(typeof v === 'string' ? v : '')"
    />
    <template v-else-if="isTextarea">
      <label class="rs-table-cell-editor__sr-label" :for="textareaId">
        {{ textareaLabel }}
      </label>
      <textarea
        :id="textareaId"
        v-model="displayModel"
        class="rs-table-cell-editor__textarea"
        :rows="textareaRows"
        :placeholder="placeholder"
        :disabled="validating"
        @keydown="onKeydown"
        @blur="onBlur"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      />
    </template>
    <RsInput
      v-else-if="isTextLike"
      v-model="displayModel"
      :type="inputType === 'textarea' ? 'text' : inputType"
      :size="size"
      :placeholder="placeholder"
      :disabled="validating"
      @press-enter="onPressEnter"
      @blur="onBlur"
      @keydown="onKeydown"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    />
  </div>
</template>
