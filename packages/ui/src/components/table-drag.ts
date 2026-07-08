import { ref, type Ref } from 'vue'
import type { RsTableRowDropPosition } from './table-utils'

export type RsTableRowDragTrigger = 'handle' | 'row'
export type RsTableRowDropMode = 'reorder' | 'into'

export interface TableRowDragState {
  dragRowKeys: Ref<string[]>
  dropRowTargetKey: Ref<string | null>
  dropRowPosition: Ref<RsTableRowDropPosition>
}

export function createTableRowDragState(): TableRowDragState {
  return {
    dragRowKeys: ref([]),
    dropRowTargetKey: ref(null),
    dropRowPosition: ref('before'),
  }
}

export function resolveTableRowDropPosition(
  event: MouseEvent,
  element: HTMLElement,
  mode: RsTableRowDropMode,
): RsTableRowDropPosition {
  if (mode === 'into') {
    return 'into'
  }
  const rect = element.getBoundingClientRect()
  return event.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
}

export function resolveDragRowKeys(
  dragKey: string,
  selectedKeys: readonly string[],
): string[] {
  if (selectedKeys.includes(dragKey) && selectedKeys.length > 1) {
    return [...selectedKeys]
  }
  return [dragKey]
}

export interface CreateTableRowDragHandlersOptions<T> {
  state: TableRowDragState
  getRowDraggable: () => boolean
  getRowDragTrigger: () => RsTableRowDragTrigger
  getRowDropMode: () => RsTableRowDropMode
  rowDraggableWhen?: (row: T, index: number) => boolean
  rowDropTargetWhen?: (row: T, index: number) => boolean
  canRowDrop?: (dragKeys: string[], dropKey: string) => boolean
  rowKeyFor: (row: T, index: number) => string
  isRowDisabled: (row: T) => boolean
  getSelectedKeys: () => string[]
  onDragStart: (dragKeys: string[], event: DragEvent) => void
  onDrop: (dragKeys: string[], dropKey: string, position: RsTableRowDropPosition) => void
}

export function createTableRowDragHandlers<T>(
  options: CreateTableRowDragHandlersOptions<T>,
) {
  const { state } = options

  function canDragRow(row: T, index: number): boolean {
    if (!options.getRowDraggable() || options.isRowDisabled(row)) {
      return false
    }
    return options.rowDraggableWhen ? options.rowDraggableWhen(row, index) : true
  }

  function canDropOnRow(row: T, index: number, dropKey: string): boolean {
    if (!state.dragRowKeys.value.length) {
      return false
    }
    if (state.dragRowKeys.value.includes(dropKey)) {
      return false
    }
    if (options.getRowDropMode() === 'into') {
      if (options.rowDropTargetWhen && !options.rowDropTargetWhen(row, index)) {
        return false
      }
    }
    if (options.canRowDrop && !options.canRowDrop(state.dragRowKeys.value, dropKey)) {
      return false
    }
    return true
  }

  function onRowDragStart(row: T, index: number, event: DragEvent): void {
    if (!options.getRowDraggable() || options.isRowDisabled(row)) {
      return
    }
    const dragKey = options.rowKeyFor(row, index)
    if (!canDragRow(row, index)) {
      return
    }
    const dragKeys = resolveDragRowKeys(dragKey, options.getSelectedKeys())
    state.dragRowKeys.value = dragKeys
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copyMove'
      event.dataTransfer.setData('text/plain', dragKeys.join(','))
    }
    options.onDragStart(dragKeys, event)
  }

  function onRowDragOver(row: T, index: number, event: DragEvent): void {
    if (!options.getRowDraggable() || !state.dragRowKeys.value.length) {
      return
    }
    const dropKey = options.rowKeyFor(row, index)
    if (!canDropOnRow(row, index, dropKey)) {
      return
    }
    event.preventDefault()
    state.dropRowTargetKey.value = dropKey
    state.dropRowPosition.value = resolveTableRowDropPosition(
      event,
      event.currentTarget as HTMLElement,
      options.getRowDropMode(),
    )
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect =
        options.getRowDropMode() === 'into' ? 'move' : 'move'
    }
  }

  function onRowDragLeave(event: DragEvent): void {
    const next = event.relatedTarget as Node | null
    const current = event.currentTarget as HTMLElement | null
    if (next && current?.contains(next)) {
      return
    }
    state.dropRowTargetKey.value = null
  }

  function onRowDrop(row: T, index: number, event: DragEvent): void {
    if (!options.getRowDraggable() || !state.dragRowKeys.value.length) {
      return
    }
    const dropKey = options.rowKeyFor(row, index)
    if (!canDropOnRow(row, index, dropKey)) {
      return
    }
    event.preventDefault()
    const position = resolveTableRowDropPosition(
      event,
      event.currentTarget as HTMLElement,
      options.getRowDropMode(),
    )
    const dragKeys = [...state.dragRowKeys.value]
    state.dragRowKeys.value = []
    state.dropRowTargetKey.value = null
    options.onDrop(dragKeys, dropKey, position)
  }

  function onRowDragEnd(): void {
    state.dragRowKeys.value = []
    state.dropRowTargetKey.value = null
  }

  function isRowDragging(dropKey: string): boolean {
    return state.dragRowKeys.value.includes(dropKey)
  }

  function isRowDropTarget(dropKey: string): boolean {
    return state.dropRowTargetKey.value === dropKey
  }

  return {
    canDragRow,
    onRowDragStart,
    onRowDragOver,
    onRowDragLeave,
    onRowDrop,
    onRowDragEnd,
    isRowDragging,
    isRowDropTarget,
  }
}
