<script setup lang="ts" generic="T extends import('../table-utils').RsTableRowData">
import type { RsTableColumn, RsTableRowDropPosition, RsTableSelectionType } from '../table-utils'
import type { RsTableCellEditTrigger } from './table-edit-utils'
import RsTableCell from './RsTableCell.vue'
import RsTableEditGutter from './RsTableEditGutter.vue'
import RsTableRowStatus from './RsTableRowStatus.vue'

defineProps<{
  row: T
  rowIndex: number
  rowKey: string
  columns: RsTableColumn<T>[]
  /** 列虚拟化左侧占位宽（px） */
  columnPadLeft?: number
  /** 列虚拟化右侧占位宽（px） */
  columnPadRight?: number
  columnTdClassMap: Map<string, string[]>
  columnStyleMap: Map<string, Record<string, string> | undefined>
  showRowDragHandle: boolean
  expandable: boolean
  selectable: boolean
  showIndex: boolean
  showEditGutter: boolean
  striped: boolean
  selectionType: RsTableSelectionType
  isRadioSelection: boolean
  tableEditable: boolean
  editTrigger: RsTableCellEditTrigger
  rowCommit: boolean
  allowNull: boolean
  focusMode: import('./table-edit-utils').RsTableCellEditFocusMode
  nullLabel: string
  showRowStatus: boolean
  selected: boolean
  highlighted: boolean
  expanded: boolean
  disabled: boolean
  rowDragByRow: boolean
  dragging: boolean
  dropTarget: boolean
  dropPosition: RsTableRowDropPosition | null
  dragLeadStyle: Record<string, string>
  expandLeadStyle: Record<string, string>
  selectLeadStyle: Record<string, string>
  indexLeadStyle: Record<string, string>
  gutterLeadStyle: Record<string, string>
  canExpand: boolean
  canSelect: boolean
  rowEditPending: boolean
  rowDirty: boolean
  /** gutter 待提交时是否显示撤销按钮 */
  showGutterRollback?: boolean
  editingColKey: string | null
  focusColKey: string | null
  hasColumnSlot: (key: string) => boolean
  hasEditSlot: (key: string) => boolean
  cellTooltipEnabled: (column: RsTableColumn<T>, rowIndex: number) => boolean
  cellTooltipMode: (column: RsTableColumn<T>, rowIndex: number) => string | undefined
  cellTooltipText: (column: RsTableColumn<T>, row: T, rowIndex: number) => string | undefined
  cellTooltipFallbackTitle: (column: RsTableColumn<T>, row: T, rowIndex: number) => string | undefined
  getCellDraft: (rowKey: string, colKey: string) => string | undefined
  isCellDirty: (rowKey: string, colKey: string) => boolean
  getCellError: (rowKey: string, colKey: string) => string | undefined
  isCellValidating: (rowKey: string, colKey: string) => boolean
  dragRowLabel: string
  expandRowLabel: string
  collapseRowLabel: string
  selectRowLabel: string
  rowCommitLabel: string
  rowRollbackLabel: string
  gutterCommitHint: string
}>()

const emit = defineEmits<{
  click: [event: MouseEvent]
  cellClick: [colKey: string, event: MouseEvent]
  cellContextmenu: [colKey: string, event: MouseEvent]
  dblclick: [event: MouseEvent]
  contextmenu: [event: MouseEvent]
  dragover: [event: DragEvent]
  dragleave: [event: DragEvent]
  drop: [event: DragEvent]
  rowDragStart: [event: DragEvent]
  rowDragEnd: []
  toggleExpand: []
  toggleSelect: []
  cellStartEdit: [colKey: string]
  cellCommit: [colKey: string, value: string]
  cellCancel: [colKey: string]
  cellUpdateDraft: [colKey: string, value: string]
  cellNavigate: [colKey: string, direction: import('./table-edit-utils').RsTableCellNavigateDirection]
  rowCommit: []
  rowRollback: []
  gutterCommit: []
}>()
</script>

<template>
  <tr
    class="rs-table__row"
    :class="{
      'rs-table__row--selected': selected,
      'rs-table__row--highlighted': highlighted && !selected,
      'rs-table__row--striped': striped && rowIndex % 2 === 1,
      'rs-table__row--disabled': disabled,
      'rs-table__row--draggable': rowDragByRow,
      'rs-table__row--dragging': dragging,
      'rs-table__row--drop-before': dropTarget && dropPosition === 'before',
      'rs-table__row--drop-after': dropTarget && dropPosition === 'after',
      'rs-table__row--drop-into': dropTarget && dropPosition === 'into',
      'rs-table__row--dirty': rowDirty || rowEditPending,
    }"
    @click="emit('click', $event)"
    @dblclick="emit('dblclick', $event)"
    @contextmenu="emit('contextmenu', $event)"
    @dragover="emit('dragover', $event)"
    @dragleave="emit('dragleave', $event)"
    @drop="emit('drop', $event)"
  >
    <td
      v-if="showRowDragHandle"
      class="rs-table__td rs-table__td--drag"
      :style="dragLeadStyle"
      @click.stop
    >
      <span
        v-if="!disabled"
        class="rs-table__row-drag-handle"
        draggable="true"
        :aria-label="dragRowLabel"
        @dragstart="emit('rowDragStart', $event)"
        @dragend="emit('rowDragEnd')"
      >⋮⋮</span>
    </td>
    <td
      v-if="expandable"
      class="rs-table__td rs-table__td--expand"
      :style="expandLeadStyle"
      @click.stop
    >
      <button
        v-if="canExpand"
        type="button"
        class="rs-table__expand-btn"
        :class="{ 'rs-table__expand-btn--expanded': expanded }"
        :aria-label="expanded ? collapseRowLabel : expandRowLabel"
        @click="emit('toggleExpand')"
      >
        ›
      </button>
    </td>
    <td
      v-if="selectable"
      class="rs-table__td rs-table__td--selection"
      :style="selectLeadStyle"
      @click.stop
    >
      <label class="rs-table__checkbox" :class="{ 'rs-table__checkbox--checked': selected }">
        <input
          :type="selectionType"
          class="rs-table__checkbox-input"
          :name="isRadioSelection ? 'rs-table-radio' : undefined"
          :checked="selected"
          :disabled="!canSelect"
          :aria-label="selectRowLabel"
          @change="emit('toggleSelect')"
        >
        <span
          class="rs-table__checkbox-box"
          :class="{ 'rs-table__checkbox-box--radio': isRadioSelection }"
          aria-hidden="true"
        />
      </label>
    </td>
    <td
      v-if="showEditGutter"
      class="rs-table__td rs-table__td--gutter rs-table__cell--center"
      :style="gutterLeadStyle"
    >
      <RsTableEditGutter
        :line-number="rowIndex + 1"
        :pending="rowEditPending"
        :commit-label="rowCommitLabel"
        :commit-hint="gutterCommitHint"
        :rollback-label="rowRollbackLabel"
        :show-rollback="showGutterRollback ?? rowCommit"
        @commit="emit('gutterCommit')"
        @rollback="emit('rowRollback')"
      />
    </td>
    <td
      v-else-if="showIndex"
      class="rs-table__td rs-table__td--index rs-table__cell--center"
      :style="indexLeadStyle"
    >
      {{ rowIndex + 1 }}
    </td>
    <td
      v-if="showRowStatus"
      class="rs-table__td rs-table__td--status rs-table__cell--center"
      @click.stop
    >
      <RsTableRowStatus
        :dirty="rowDirty"
        :commit-label="rowCommitLabel"
        :rollback-label="rowRollbackLabel"
        @commit="emit('rowCommit')"
        @rollback="emit('rowRollback')"
      />
    </td>
    <td
      v-if="(columnPadLeft ?? 0) > 0"
      class="rs-table__td rs-table__col-pad"
      :style="{ width: `${columnPadLeft}px`, minWidth: `${columnPadLeft}px` }"
    />
    <td
      v-for="column in columns"
      :key="column.key"
      class="rs-table__td rs-table__td--data"
      :class="[
        columnTdClassMap.get(column.key),
        {
          'rs-table__td--row-draggable': rowDragByRow,
          'rs-table__td--editing': editingColKey === column.key,
          'rs-table__td--focused': focusColKey === column.key && editingColKey !== column.key,
          'rs-table__td--invalid': !!getCellError(rowKey, column.key),
        },
      ]"
      :style="columnStyleMap.get(column.key)"
      :draggable="rowDragByRow"
      :aria-selected="focusColKey === column.key || editingColKey === column.key ? 'true' : undefined"
      @click.stop="emit('cellClick', column.key, $event)"
      @dblclick.stop="emit('cellStartEdit', column.key)"
      @contextmenu="emit('cellContextmenu', column.key, $event)"
      @dragstart="rowDragByRow ? emit('rowDragStart', $event) : undefined"
      @dragend="rowDragByRow ? emit('rowDragEnd') : undefined"
    >
      <span
        :class="[
          { 'rs-table__cell-tip': cellTooltipEnabled(column, rowIndex) },
          { 'rs-table__cell-tip--editing': editingColKey === column.key },
        ]"
        :data-rs-table-tip-mode="cellTooltipEnabled(column, rowIndex) ? cellTooltipMode(column, rowIndex) : undefined"
        :data-rs-table-tip-text="cellTooltipText(column, row, rowIndex)"
        :title="getCellError(rowKey, column.key) || cellTooltipFallbackTitle(column, row, rowIndex)"
      >
        <RsTableCell
          :column="column"
          :row="row"
          :row-index="rowIndex"
          :row-key="rowKey"
          :table-editable="tableEditable"
          :editing="editingColKey === column.key"
          :dirty="isCellDirty(rowKey, column.key)"
          :focused="focusColKey === column.key"
          :draft="getCellDraft(rowKey, column.key)"
          :has-custom-slot="hasColumnSlot(column.key)"
          :has-edit-slot="hasEditSlot(column.key)"
          :edit-trigger="editTrigger"
          :row-commit="rowCommit"
          :allow-null="allowNull"
          :focus-mode="focusMode"
          :null-label="nullLabel"
          :error-message="getCellError(rowKey, column.key) ?? null"
          :validating="isCellValidating(rowKey, column.key)"
          @start-edit="emit('cellStartEdit', column.key)"
          @commit="emit('cellCommit', column.key, $event)"
          @cancel="emit('cellCancel', column.key)"
          @update-draft="emit('cellUpdateDraft', column.key, $event)"
          @navigate="emit('cellNavigate', column.key, $event)"
        >
          <slot :name="column.key" :row="row" :column="column" :index="rowIndex" />
          <template v-if="hasEditSlot(column.key)" #editor="scope">
            <slot :name="`edit-${column.key}`" v-bind="scope" />
          </template>
        </RsTableCell>
      </span>
    </td>
    <td
      v-if="(columnPadRight ?? 0) > 0"
      class="rs-table__td rs-table__col-pad"
      :style="{ width: `${columnPadRight}px`, minWidth: `${columnPadRight}px` }"
    />
  </tr>
</template>
