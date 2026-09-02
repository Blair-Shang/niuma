import { computed, shallowRef, type Ref } from 'vue'
import type { CellViewDialogLabels } from './useCellViewDialog'

const seats = new Set<symbol>()
const leaderSeat = shallowRef<symbol | null>(null)

export function claimQueryCellDialogSeat(): symbol {
  const id = Symbol('query-cell-dialog-seat')
  seats.add(id)
  leaderSeat.value ??= id
  return id
}

export function releaseQueryCellDialogSeat(id: symbol): void {
  seats.delete(id)
  if (leaderSeat.value !== id) return
  const next = seats.values().next()
  leaderSeat.value = next.done ? null : next.value
}

export function isQueryCellDialogLeader(id: symbol): boolean {
  return leaderSeat.value === id
}

export interface QueryCellDialogBind {
  owner: string
  open: Ref<boolean>
  draft: Ref<string>
  title: Ref<string>
  labels: () => CellViewDialogLabels
  copyFull: () => Promise<boolean>
}

const bind = shallowRef<QueryCellDialogBind | null>(null)

export function bindQueryCellDialog(next: QueryCellDialogBind): void {
  bind.value = next
}

export function unbindQueryCellDialog(owner: string): void {
  if (bind.value?.owner !== owner) return
  bind.value.open.value = false
  bind.value = null
}

function hostLabels(): CellViewDialogLabels {
  return (
    bind.value?.labels() ?? {
      viewTitle: '',
      close: '',
      copyFull: '',
      copied: '',
    }
  )
}

function hostCopyFull(): Promise<boolean> {
  return bind.value?.copyFull() ?? Promise.resolve(false)
}

export function useQueryCellDialogHost() {
  const open = computed({
    get: () => bind.value?.open.value ?? false,
    set: (value: boolean) => {
      if (bind.value) bind.value.open.value = value
    },
  })
  const draft = computed({
    get: () => bind.value?.draft.value ?? '',
    set: (value: string) => {
      if (bind.value) bind.value.draft.value = value
    },
  })
  const title = computed(() => bind.value?.title.value ?? '')

  return { open, draft, title, labels: hostLabels, copyFull: hostCopyFull }
}
