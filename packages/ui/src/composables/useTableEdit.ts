import { shallowRef, ref, type Ref } from 'vue'
import { makeCellKey } from '../components/table/table-keys'

export interface RsTableEditingCell {
  rowKey: string
  colKey: string
  rowIndex: number
}

export interface RsTableStagedCell {
  rowKey: string
  colKey: string
  rowIndex: number
  draft: string
  original: unknown
}

export interface RsTableFocusCell {
  rowKey: string
  colKey: string
  rowIndex: number
}

export interface RsTableUndoEntry {
  items: Array<{
    rowKey: string
    colKey: string
    rowIndex: number
    previous: unknown
    next: unknown
  }>
}

export function useTableEdit(options: {
  enabled: () => boolean
  undoLimit?: () => number
}): {
  editingCell: Ref<RsTableEditingCell | null>
  editingDraft: Ref<string>
  focusCell: Ref<RsTableFocusCell | null>
  stagedMap: Ref<Map<string, RsTableStagedCell>>
  errorMap: Ref<Map<string, string>>
  validatingMap: Ref<Map<string, boolean>>
  undoStack: Ref<RsTableUndoEntry[]>
  redoStack: Ref<RsTableUndoEntry[]>
  isEditing: (rowKey: string, colKey: string) => boolean
  isFocused: (rowKey: string, colKey: string) => boolean
  getDraft: (rowKey: string, colKey: string) => string | undefined
  isDirty: (rowKey: string, colKey: string) => boolean
  isRowDirty: (rowKey: string) => boolean
  getCellError: (rowKey: string, colKey: string) => string | undefined
  setCellError: (rowKey: string, colKey: string, message: string | null) => void
  clearCellError: (rowKey: string, colKey: string) => void
  isValidating: (rowKey: string, colKey: string) => boolean
  setValidating: (rowKey: string, colKey: string, value: boolean) => void
  getRowStagedCells: (rowKey: string) => RsTableStagedCell[]
  startEdit: (cell: RsTableEditingCell, initialText: string) => void
  updateDraft: (text: string) => void
  cancelEdit: () => void
  cancelAll: () => void
  setFocusCell: (cell: RsTableFocusCell | null) => void
  stageCell: (cell: RsTableStagedCell) => void
  unstageCell: (rowKey: string, colKey: string) => void
  rollbackRow: (rowKey: string) => void
  commitRow: (rowKey: string) => RsTableStagedCell[]
  pushUndo: (entry: RsTableUndoEntry | RsTableUndoEntry['items'][number]) => void
  undo: () => RsTableUndoEntry | null
  redo: () => RsTableUndoEntry | null
} {
  const editingCell = ref<RsTableEditingCell | null>(null)
  const editingDraft = ref('')
  const focusCell = ref<RsTableFocusCell | null>(null)
  const stagedMap = shallowRef(new Map<string, RsTableStagedCell>())
  const errorMap = shallowRef(new Map<string, string>())
  const validatingMap = shallowRef(new Map<string, boolean>())
  const undoStack = shallowRef<RsTableUndoEntry[]>([])
  const redoStack = shallowRef<RsTableUndoEntry[]>([])

  function isEditing(rowKey: string, colKey: string): boolean {
    const active = editingCell.value
    return active?.rowKey === rowKey && active.colKey === colKey
  }

  function isFocused(rowKey: string, colKey: string): boolean {
    const active = focusCell.value
    return active?.rowKey === rowKey && active.colKey === colKey
  }

  function getDraft(rowKey: string, colKey: string): string | undefined {
    const staged = stagedMap.value.get(makeCellKey(rowKey, colKey))
    if (staged) return staged.draft
    if (isEditing(rowKey, colKey)) return editingDraft.value
    return undefined
  }

  function isDirty(rowKey: string, colKey: string): boolean {
    return stagedMap.value.has(makeCellKey(rowKey, colKey))
  }

  function getRowStagedCells(rowKey: string): RsTableStagedCell[] {
    return [...stagedMap.value.values()].filter((item) => item.rowKey === rowKey)
  }

  function isRowDirty(rowKey: string): boolean {
    return getRowStagedCells(rowKey).length > 0
  }

  function getCellError(rowKey: string, colKey: string): string | undefined {
    return errorMap.value.get(makeCellKey(rowKey, colKey))
  }

  function setCellError(rowKey: string, colKey: string, message: string | null): void {
    const key = makeCellKey(rowKey, colKey)
    const next = new Map(errorMap.value)
    if (!message) next.delete(key)
    else next.set(key, message)
    errorMap.value = next
  }

  function clearCellError(rowKey: string, colKey: string): void {
    setCellError(rowKey, colKey, null)
  }

  function isValidating(rowKey: string, colKey: string): boolean {
    return validatingMap.value.get(makeCellKey(rowKey, colKey)) === true
  }

  function setValidating(rowKey: string, colKey: string, value: boolean): void {
    const key = makeCellKey(rowKey, colKey)
    const next = new Map(validatingMap.value)
    if (!value) next.delete(key)
    else next.set(key, true)
    validatingMap.value = next
  }

  function startEdit(cell: RsTableEditingCell, initialText: string): void {
    if (!options.enabled()) return
    editingCell.value = cell
    focusCell.value = cell
    const staged = stagedMap.value.get(makeCellKey(cell.rowKey, cell.colKey))
    editingDraft.value = staged?.draft ?? initialText
    clearCellError(cell.rowKey, cell.colKey)
  }

  function updateDraft(text: string): void {
    if (!editingCell.value) return
    editingDraft.value = text
  }

  function cancelEdit(): void {
    editingCell.value = null
    editingDraft.value = ''
  }

  function cancelAll(): void {
    editingCell.value = null
    editingDraft.value = ''
    stagedMap.value = new Map()
    errorMap.value = new Map()
    validatingMap.value = new Map()
  }

  function setFocusCell(cell: RsTableFocusCell | null): void {
    focusCell.value = cell
  }

  function stageCell(cell: RsTableStagedCell): void {
    const key = makeCellKey(cell.rowKey, cell.colKey)
    const next = new Map(stagedMap.value)
    next.set(key, cell)
    stagedMap.value = next
    clearCellError(cell.rowKey, cell.colKey)
    if (editingCell.value?.rowKey === cell.rowKey && editingCell.value.colKey === cell.colKey) {
      editingCell.value = null
      editingDraft.value = ''
    }
  }

  function removeStagedKeys(keys: string[]): void {
    if (!keys.length) return
    const next = new Map(stagedMap.value)
    for (const key of keys) next.delete(key)
    stagedMap.value = next
  }

  function unstageCell(rowKey: string, colKey: string): void {
    removeStagedKeys([makeCellKey(rowKey, colKey)])
  }

  function rollbackRow(rowKey: string): void {
    const keys = [...stagedMap.value.keys()].filter((key) => key.startsWith(`${rowKey}:`))
    removeStagedKeys(keys)
    const errNext = new Map(errorMap.value)
    for (const key of [...errNext.keys()]) {
      if (key.startsWith(`${rowKey}:`)) errNext.delete(key)
    }
    errorMap.value = errNext
    if (editingCell.value?.rowKey === rowKey) cancelEdit()
  }

  function commitRow(rowKey: string): RsTableStagedCell[] {
    const changes = getRowStagedCells(rowKey)
    rollbackRow(rowKey)
    return changes
  }

  function normalizeUndo(
    entry: RsTableUndoEntry | RsTableUndoEntry['items'][number],
  ): RsTableUndoEntry {
    if ('items' in entry) return entry
    return { items: [entry] }
  }

  function pushUndo(entry: RsTableUndoEntry | RsTableUndoEntry['items'][number]): void {
    const limit = options.undoLimit?.() ?? 50
    undoStack.value = [...undoStack.value, normalizeUndo(entry)].slice(-Math.max(1, limit))
    redoStack.value = []
  }

  function undo(): RsTableUndoEntry | null {
    const stack = undoStack.value
    if (!stack.length) return null
    const entry = stack[stack.length - 1]!
    undoStack.value = stack.slice(0, -1)
    redoStack.value = [...redoStack.value, entry]
    return entry
  }

  function redo(): RsTableUndoEntry | null {
    const stack = redoStack.value
    if (!stack.length) return null
    const entry = stack[stack.length - 1]!
    redoStack.value = stack.slice(0, -1)
    undoStack.value = [...undoStack.value, entry]
    return entry
  }

  return {
    editingCell,
    editingDraft,
    focusCell,
    stagedMap,
    errorMap,
    validatingMap,
    undoStack,
    redoStack,
    isEditing,
    isFocused,
    getDraft,
    isDirty,
    isRowDirty,
    getCellError,
    setCellError,
    clearCellError,
    isValidating,
    setValidating,
    getRowStagedCells,
    startEdit,
    updateDraft,
    cancelEdit,
    cancelAll,
    setFocusCell,
    stageCell,
    unstageCell,
    rollbackRow,
    commitRow,
    pushUndo,
    undo,
    redo,
  }
}
