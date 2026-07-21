<script setup lang="ts" generic="T extends import('../table-utils').RsTableRowData">
import { computed, ref, watch } from 'vue'
import type { RsTableColumn } from '../table-utils'
import RsCheckbox from '../RsCheckbox.vue'
import RsTableCellEditor from './RsTableCellEditor.vue'
import {
  booleanToEditText,
  coerceBoolean,
  formatCellDisplayValue,
  isBooleanToggleColumn,
  isColumnEditable,
  isColumnNullable,
  isNullDraft,
  nullToEditText,
  resolveCellEditText,
  resolveColumnCommitOn,
  resolveColumnEditorOptions,
  resolveColumnEditTrigger,
  resolveColumnRawValue,
  resolveColumnValueType,
  type RsTableCellCommitTrigger,
  type RsTableCellEditFocusMode,
  type RsTableCellEditTrigger,
  type RsTableCellNavigateDirection,
} from './table-edit-utils'

const props = withDefaults(
  defineProps<{
    column: RsTableColumn<T>
    row: T
    rowIndex: number
    rowKey: string
    tableEditable?: boolean
    editing?: boolean
    dirty?: boolean
    focused?: boolean
    draft?: string
    hasCustomSlot?: boolean
    hasEditSlot?: boolean
    editTrigger?: RsTableCellEditTrigger
    rowCommit?: boolean
    allowNull?: boolean
    focusMode?: RsTableCellEditFocusMode
    nullLabel?: string
    errorMessage?: string | null
    validating?: boolean
  }>(),
  {
    tableEditable: false,
    editing: false,
    dirty: false,
    focused: false,
    hasCustomSlot: false,
    hasEditSlot: false,
    editTrigger: 'dblclick',
    rowCommit: false,
    allowNull: true,
    focusMode: 'end',
    nullLabel: '(NULL)',
    errorMessage: null,
    validating: false,
  },
)

const emit = defineEmits<{
  startEdit: []
  commit: [value: string]
  cancel: []
  updateDraft: [value: string]
  navigate: [direction: RsTableCellNavigateDirection]
}>()

const localDraft = ref('')

const editable = computed(() =>
  isColumnEditable(props.column, props.row, props.rowIndex, props.tableEditable),
)

const valueType = computed(() => resolveColumnValueType(props.column))
const editorOptions = computed(() =>
  resolveColumnEditorOptions(props.column, props.row, props.rowIndex),
)
const isBoolean = computed(() => isBooleanToggleColumn(props.column))
const nullable = computed(() => isColumnNullable(props.column, props.allowNull))
const resolvedEditTrigger = computed(() =>
  resolveColumnEditTrigger(props.column, props.editTrigger),
)
const resolvedCommitOn = computed((): RsTableCellCommitTrigger =>
  resolveColumnCommitOn(props.column, props.rowCommit),
)

const booleanChecked = computed(() => {
  if (props.draft !== undefined) {
    if (isNullDraft(props.draft)) return false
    return coerceBoolean(props.draft)
  }
  const raw = resolveColumnRawValue(props.row, props.column, props.rowIndex)
  if (raw == null) return false
  return coerceBoolean(raw)
})

const rawValue = computed(() => {
  if (props.draft !== undefined) {
    if (isNullDraft(props.draft)) return null
    return props.draft
  }
  return resolveColumnRawValue(props.row, props.column, props.rowIndex)
})

const isNullDisplay = computed(() => rawValue.value === null || rawValue.value === undefined)

const displayText = computed(() => {
  if (props.draft !== undefined) {
    return formatCellDisplayValue(props.draft, props.row, props.column, props.rowIndex, {
      nullLabel: props.nullLabel,
    })
  }
  return formatCellDisplayValue(rawValue.value, props.row, props.column, props.rowIndex, {
    nullLabel: props.nullLabel,
  })
})

watch(
  () => props.editing,
  (editing) => {
    if (!editing) return
    localDraft.value = resolveCellEditText(
      props.row,
      props.column,
      props.rowIndex,
      props.draft,
    )
  },
  { immediate: true },
)

function onDisplayClick(): void {
  if (!editable.value || isBoolean.value) return
  if (resolvedEditTrigger.value === 'click') emit('startEdit')
}

function onDisplayDblClick(event: MouseEvent): void {
  if (!editable.value || isBoolean.value) return
  event.stopPropagation()
  if (resolvedEditTrigger.value === 'dblclick') emit('startEdit')
}

function onBooleanToggle(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
  if (!editable.value) return
  emit('commit', booleanToEditText(!booleanChecked.value))
}

function onEditorUpdate(value: string): void {
  localDraft.value = value
  emit('updateDraft', value)
}

function onEditorCommit(): void {
  emit('commit', localDraft.value)
}

function onEditorCancel(): void {
  emit('cancel')
}

function onEditorNavigate(direction: RsTableCellNavigateDirection): void {
  emit('navigate', direction)
}

function onEditorSetNull(): void {
  localDraft.value = nullToEditText()
  emit('updateDraft', localDraft.value)
}
</script>

<template>
  <RsCheckbox
    v-if="!editing && isBoolean && editable"
    class="rs-table__cell-check"
    :class="{
      'rs-table__cell-check--dirty': dirty,
      'rs-table__cell-check--invalid': !!errorMessage,
    }"
    size="sm"
    :model-value="booleanChecked"
    :aria-label="column.title"
    @click.prevent.stop="onBooleanToggle"
    @dblclick.stop
  />
  <span
    v-else-if="!editing"
    class="rs-table__cell-body"
    :class="{
      'rs-table__ellipsis-text': column.ellipsis,
      'rs-table__cell-body--editable': editable,
      'rs-table__cell-body--readonly': tableEditable && !editable,
      'rs-table__cell-body--dirty': dirty,
      'rs-table__cell-body--null': isNullDisplay,
      'rs-table__cell-body--invalid': !!errorMessage,
      'rs-table__cell-body--focused': focused && !editing,
    }"
    :title="errorMessage || undefined"
    :aria-readonly="tableEditable && !editable ? 'true' : undefined"
    :aria-invalid="errorMessage ? 'true' : undefined"
    @click="onDisplayClick"
    @dblclick="onDisplayDblClick"
  >
    <slot>{{ displayText }}</slot>
  </span>
  <div v-else-if="hasEditSlot" class="rs-table-cell-editor rs-table-cell-editor--custom">
    <slot
      name="editor"
      :draft="localDraft"
      :row="row"
      :column="column"
      :index="rowIndex"
      :error="errorMessage"
      :update="onEditorUpdate"
      :commit="onEditorCommit"
      :cancel="onEditorCancel"
    />
  </div>
  <RsTableCellEditor
    v-else
    v-model="localDraft"
    :value-type="valueType"
    :editor-options="editorOptions"
    size="sm"
    :commit-on="resolvedCommitOn"
    :focus-mode="focusMode"
    :allow-null="nullable"
    :error-message="errorMessage"
    :validating="validating"
    @update:model-value="onEditorUpdate"
    @commit="onEditorCommit"
    @cancel="onEditorCancel"
    @navigate="onEditorNavigate"
    @set-null="onEditorSetNull"
  />
</template>
