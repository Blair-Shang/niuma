import { computed, ref, type ComputedRef, type Ref } from 'vue'

export function useTableRowHighlight(options: {
  enabled: () => boolean
  highlightRowOnClick: () => boolean
  isControlled: () => boolean
  highlightedRowKey: () => string | undefined
  defaultHighlightedRowKey: () => string | undefined
  onUpdate: (value: string | undefined) => void
}): {
  highlightedKey: ComputedRef<string | undefined>
  setHighlightedKey: (value: string | undefined) => void
  isHighlighted: (rowKey: string) => boolean
  applyRowClickHighlight: (rowKey: string) => void
} {
  const internalHighlightedKey = ref<string | undefined>(options.defaultHighlightedRowKey())

  const highlightedKey = computed({
    get: () => (options.isControlled() ? options.highlightedRowKey() : internalHighlightedKey.value),
    set: (value: string | undefined) => {
      if (options.isControlled()) {
        options.onUpdate(value)
        return
      }
      internalHighlightedKey.value = value
      options.onUpdate(value)
    },
  })

  function setHighlightedKey(value: string | undefined): void {
    highlightedKey.value = value
  }

  function isHighlighted(rowKey: string): boolean {
    if (!options.enabled()) return false
    return highlightedKey.value === rowKey
  }

  function applyRowClickHighlight(rowKey: string): void {
    if (!options.enabled() || !options.highlightRowOnClick()) return
    setHighlightedKey(rowKey)
  }

  return {
    highlightedKey,
    setHighlightedKey,
    isHighlighted,
    applyRowClickHighlight,
  }
}
