<script setup lang="ts">
/**
 * 浏览数据网格：RsTable（row-commit）+ 表格级单例大字段编辑器。
 * BrowseCellEditorDialog 内 CodeMirror 按表格挂载一次、关闭停放复用。
 * 不可编辑单元格双击走只读查看（截断展示，关闭释放）。
 */
import { RsTable, type RsContextMenuItem, type RsTableColumn } from '@niuma/ui'
import { toRef } from 'vue'
import type { BrowseDataRow } from '../types/browse-data'
import BrowseCellEditorDialog from './BrowseCellEditorDialog.vue'
import { useBrowseGridEditing } from '../composables/useBrowseGridEditing'
import type {
  BrowseCellEditorDialogLabels,
  BrowseResolveFullCellValue,
} from '../composables/useBrowseCellDialog'
import type { BrowseRowChange } from '../utils/browse-result-column'

const selectedRowKeys = defineModel<string[]>('selectedRowKeys', { default: () => [] })

const props = withDefaults(
  defineProps<{
    columns: RsTableColumn<BrowseDataRow>[]
    data: BrowseDataRow[]
    loading?: boolean
    editable?: boolean
    allowNull?: boolean
    rowPending?: (row: BrowseDataRow, index: number) => boolean
    contextMenuItems?: (row: BrowseDataRow | null, selectedRows: BrowseDataRow[]) => RsContextMenuItem[]
    layoutActive?: boolean
    gutterWidth?: number
    dialogLabels?: Partial<BrowseCellEditorDialogLabels>
    emptyText?: string
    /** 方言异步加载截断 LOB 全量（如 Oracle query.loadLob） */
    resolveFullCellValue?: BrowseResolveFullCellValue
  }>(),
  {
    loading: false,
    editable: false,
    allowNull: false,
    layoutActive: true,
    gutterWidth: 40,
    emptyText: '',
  },
)

const emit = defineEmits<{
  cellEditCommit: [
    row: BrowseDataRow,
    column: RsTableColumn<BrowseDataRow>,
    index: number,
    value: unknown,
  ]
  rowEditCommit: [row: BrowseDataRow, index: number, changes: BrowseRowChange[]]
  rowEditRollback: [row: BrowseDataRow, index: number]
  contextMenuSelect: [key: string, row: BrowseDataRow | null, selectedRows: BrowseDataRow[]]
}>()

const {
  tableRef,
  open: cellDialogOpen,
  draft: cellDialogDraft,
  readonly: cellDialogReadonly,
  title: cellDialogTitle,
  labels: cellDialogLabels,
  onCellEditDialog,
  openView: onCellView,
  onApply: onCellDialogApply,
  onCancel: onCellDialogCancel,
  copyFull: onCellCopyFull,
  gridEditProps,
} = useBrowseGridEditing({
  getLabels: () => props.dialogLabels ?? {},
  resolveFullCellValue: props.resolveFullCellValue,
})

const layoutActive = toRef(props, 'layoutActive')
</script>

<template>
  <div class="nm-browse-data-grid">
    <RsTable
      ref="tableRef"
      v-model:selected-row-keys="selectedRowKeys"
      class="nm-browse-data-grid__table"
      :columns="columns"
      :data="data"
      row-key="__rowKey"
      v-bind="gridEditProps"
      :index-width="gutterWidth"
      :edit-gutter-width="gutterWidth"
      :editable="editable"
      :allow-null="allowNull ?? editable"
      :row-pending="rowPending"
      :context-menu-items="contextMenuItems"
      :loading="loading"
      :layout-active="layoutActive"
      @cell-edit-commit="(row, column, index, value) => emit('cellEditCommit', row, column, index, value)"
      @cell-edit-dialog="onCellEditDialog"
      @cell-view="onCellView"
      @row-edit-commit="(row, index, changes) => emit('rowEditCommit', row, index, changes)"
      @row-edit-rollback="(row, index) => emit('rowEditRollback', row, index)"
      @context-menu-select="(key, row, selected) => emit('contextMenuSelect', key, row, selected)"
    >
      <template #empty>
        <slot name="empty">{{ emptyText }}</slot>
      </template>
    </RsTable>

    <BrowseCellEditorDialog
      v-model:open="cellDialogOpen"
      v-model:draft="cellDialogDraft"
      :title="cellDialogTitle"
      :readonly="cellDialogReadonly"
      :apply-label="cellDialogLabels().apply"
      :cancel-label="cellDialogLabels().cancel"
      :show-copy-full="cellDialogReadonly"
      :copy-full-label="cellDialogLabels().copyFull"
      :copied-label="cellDialogLabels().copied"
      @apply="onCellDialogApply"
      @cancel="onCellDialogCancel"
      @copy-full="onCellCopyFull"
    />
  </div>
</template>

<style scoped>
.nm-browse-data-grid {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.nm-browse-data-grid__table {
  flex: 1;
  min-height: 0;
}
</style>
