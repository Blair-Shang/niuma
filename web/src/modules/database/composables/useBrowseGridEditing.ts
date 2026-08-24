/**
 * 浏览网格编辑接线：tableRef + 大字段弹窗 + row-commit 约定。
 * 写库仍由方言 onRowEditCommit / persistRowChanges 完成。
 */
import { ref, type Ref } from 'vue'
import type { RsTableStagedCell } from '@niuma/ui'
import {
  useBrowseCellDialog,
  type BrowseCellEditorDialogLabels,
  type BrowseResolveFullCellValue,
} from './useBrowseCellDialog'

export type BrowseStageableTable = {
  stageCell: (cell: RsTableStagedCell) => void
}

export interface UseBrowseGridEditingOptions {
  getLabels?: () => Partial<BrowseCellEditorDialogLabels>
  tableRef?: Ref<BrowseStageableTable | null | undefined>
  resolveFullCellValue?: BrowseResolveFullCellValue
}

/** RsTable 浏览编辑的公共 props（方言补 columns/data/事件回调）。 */
export const BROWSE_GRID_EDIT_PROPS = {
  editTrigger: 'dblclick' as const,
  rowCommit: true,
  size: 'sm' as const,
  striped: true,
  fill: true,
  bordered: true,
  columnBordered: true,
  rounded: false,
  showIndex: true,
  resizable: true,
  columnLayout: 'fixed' as const,
  cellTooltip: true,
  highlightRow: true,
  selectable: true,
  selectionType: 'row' as const,
  virtual: true,
  virtualAutoThreshold: 40,
  virtualColumnsAutoThreshold: 40,
}

export function useBrowseGridEditing(options: UseBrowseGridEditingOptions = {}) {
  const tableRef = options.tableRef ?? ref<BrowseStageableTable | null>(null)
  const dialog = useBrowseCellDialog(
    tableRef,
    options.getLabels,
    options.resolveFullCellValue,
  )

  return {
    tableRef,
    ...dialog,
    gridEditProps: BROWSE_GRID_EDIT_PROPS,
  }
}
