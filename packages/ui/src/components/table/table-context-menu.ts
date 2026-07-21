import type { RsContextMenuItem } from '../context-menu-utils'
import type { RsTableColumn, RsTableRowData } from '../table-utils'
import { formatCellDisplayValue, resolveCellEditText, resolveColumnRawValue } from './table-edit-utils'

export const TABLE_CTX_COPY_CELL = 'copyCell'
export const TABLE_CTX_COPY_ROW = 'copyRow'

export function buildDefaultTableContextMenuItems(options: {
  copyCellLabel: string
  copyRowLabel: string
  hasRow: boolean
  hasCell: boolean
}): RsContextMenuItem[] {
  const items: RsContextMenuItem[] = []
  if (options.hasRow && options.hasCell) {
    items.push({ key: TABLE_CTX_COPY_CELL, label: options.copyCellLabel, icon: 'copy' })
  }
  if (options.hasRow) {
    items.push({ key: TABLE_CTX_COPY_ROW, label: options.copyRowLabel, icon: 'copy' })
  }
  return items
}

export function resolveTableCellCopyText<T extends RsTableRowData>(
  row: T,
  column: RsTableColumn<T>,
  rowIndex: number,
  draft?: string,
): string {
  return resolveCellEditText(row, column, rowIndex, draft)
}

export function resolveTableRowCopyText<T extends RsTableRowData>(
  row: T,
  rowIndex: number,
  columns: RsTableColumn<T>[],
  getDraft?: (rowKey: string, colKey: string) => string | undefined,
  rowKey?: string,
): string {
  return columns
    .map((column) => {
      const draft = rowKey && getDraft ? getDraft(rowKey, column.key) : undefined
      if (draft !== undefined) {
        return formatCellDisplayValue(draft, row, column, rowIndex)
      }
      return formatCellDisplayValue(resolveColumnRawValue(row, column, rowIndex), row, column, rowIndex)
    })
    .join('\t')
}

export function isBuiltInTableContextMenuKey(key: string): boolean {
  return key === TABLE_CTX_COPY_CELL || key === TABLE_CTX_COPY_ROW
}
