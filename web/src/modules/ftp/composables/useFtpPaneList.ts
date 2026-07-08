import { computed, ref, type Ref } from 'vue'

export type FtpPaneEntry = {
  name: string
  kind: 'file' | 'dir' | 'link'
  size: number
  modifiedAt?: string
}

export type FtpPaneSide = 'local' | 'remote'

export type FtpSortKey = 'name' | 'size' | 'modified' | 'kind'

export function useFtpPaneList(entries: Ref<FtpPaneEntry[]>) {
  const filterQuery = ref('')
  const sortKey = ref<FtpSortKey>('name')
  const sortAsc = ref(true)
  const selectedNames = ref<Set<string>>(new Set())
  const anchorIndex = ref(-1)

  const filteredEntries = computed(() => {
    const q = filterQuery.value.trim().toLowerCase()
    if (!q) {
      return entries.value
    }
    return entries.value.filter((e) => e.name.toLowerCase().includes(q))
  })

  const sortedEntries = computed(() => {
    const list = [...filteredEntries.value]
    const dir = sortAsc.value ? 1 : -1
    list.sort((a, b) => {
      if (a.kind === 'dir' && b.kind !== 'dir') {
        return -1
      }
      if (a.kind !== 'dir' && b.kind === 'dir') {
        return 1
      }
      switch (sortKey.value) {
        case 'size':
          return (a.size - b.size) * dir
        case 'modified': {
          const ta = a.modifiedAt ? Date.parse(a.modifiedAt) : 0
          const tb = b.modifiedAt ? Date.parse(b.modifiedAt) : 0
          return (ta - tb) * dir
        }
        case 'kind':
          return a.kind.localeCompare(b.kind) * dir
        default:
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * dir
      }
    })
    return list
  })

  const selectedEntries = computed(() =>
    sortedEntries.value.filter((e) => selectedNames.value.has(e.name)),
  )

  const selectionStats = computed(() => {
    const sel = selectedEntries.value
    return {
      count: sel.length,
      files: sel.filter((e) => e.kind === 'file'),
      dirs: sel.filter((e) => e.kind === 'dir'),
    }
  })

  function clearSelection(): void {
    selectedNames.value = new Set()
    anchorIndex.value = -1
  }

  function selectAll(): void {
    selectedNames.value = new Set(sortedEntries.value.map((e) => e.name))
  }

  function selectSingle(entry: FtpPaneEntry, index: number): void {
    selectedNames.value = new Set([entry.name])
    anchorIndex.value = index
  }

  function toggleSelect(entry: FtpPaneEntry, index: number, extend: boolean, range: boolean): void {
    if (range && anchorIndex.value >= 0) {
      const start = Math.min(anchorIndex.value, index)
      const end = Math.max(anchorIndex.value, index)
      const next = extend ? new Set(selectedNames.value) : new Set<string>()
      for (let i = start; i <= end; i++) {
        next.add(sortedEntries.value[i]!.name)
      }
      selectedNames.value = next
      return
    }
    if (extend) {
      const next = new Set(selectedNames.value)
      if (next.has(entry.name)) {
        next.delete(entry.name)
      } else {
        next.add(entry.name)
      }
      selectedNames.value = next
      anchorIndex.value = index
      return
    }
    selectSingle(entry, index)
  }

  function toggleSort(key: FtpSortKey): void {
    if (sortKey.value === key) {
      sortAsc.value = !sortAsc.value
    } else {
      sortKey.value = key
      sortAsc.value = key === 'name'
    }
  }

  function resetOnNavigate(): void {
    clearSelection()
    filterQuery.value = ''
  }

  return {
    filterQuery,
    sortKey,
    sortAsc,
    selectedNames,
    sortedEntries,
    selectedEntries,
    selectionStats,
    clearSelection,
    selectAll,
    selectSingle,
    toggleSelect,
    toggleSort,
    resetOnNavigate,
  }
}
