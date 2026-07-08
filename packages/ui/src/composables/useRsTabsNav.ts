import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'
import { resolveVisibleTabValues, type RsTabItem, type RsTabsOverflow } from '../components/tabs-utils'

interface UseRsTabsNavOptions {
  items: ComputedRef<RsTabItem[]>
  activeValue: Ref<string>
  overflow: ComputedRef<RsTabsOverflow | false>
  canAdd: ComputedRef<boolean>
  navRef: Ref<HTMLElement | null>
  measureRef: Ref<HTMLElement | null>
  overflowRef: Ref<HTMLElement | null>
  addButtonWidth: number
}

export function useRsTabsNav(options: UseRsTabsNavOptions) {
  const navViewportRef = ref<HTMLElement | null>(null)
  const triggerWidths = ref<Map<string, number>>(new Map())
  const visibleValues = ref<Set<string>>(new Set())
  const canScrollPrev = ref(false)
  const canScrollNext = ref(false)

  let resizeObserver: ResizeObserver | null = null

  const useDropdownOverflow = computed(() => options.overflow.value === 'dropdown')
  const useScrollOverflow = computed(() => options.overflow.value === 'scroll')

  const visibleTabItems = computed(() =>
    options.items.value.filter((item) => visibleValues.value.has(item.value)),
  )

  const hiddenItems = computed(() =>
    options.items.value.filter((item) => !visibleValues.value.has(item.value)),
  )

  const overflowMenuItems = computed(() =>
    hiddenItems.value.map((item) => ({ value: item.value, label: item.label })),
  )

  const activeInHidden = computed(() =>
    hiddenItems.value.some((item) => item.value === options.activeValue.value),
  )

  const showOverflowMenu = computed(
    () => useDropdownOverflow.value && hiddenItems.value.length > 0,
  )

  function measureTriggerWidths(): Map<string, number> {
    const measureRoot = options.measureRef.value
    if (measureRoot) {
      const next = new Map<string, number>()
      for (const node of measureRoot.querySelectorAll<HTMLElement>('[data-tab-value]')) {
        const value = node.dataset.tabValue
        if (value) next.set(value, node.offsetWidth)
      }
      if (next.size > 0) return next
    }

    const viewport = navViewportRef.value
    const next = new Map<string, number>()
    if (!viewport) return next
    for (const trigger of viewport.querySelectorAll<HTMLElement>('.rs-tabs__trigger[data-tab-value]')) {
      const value = trigger.dataset.tabValue
      if (value) next.set(value, trigger.offsetWidth)
    }
    return next
  }

  function reservedWidth(): number {
    let width = 0
    if (useDropdownOverflow.value && options.items.value.length > 1) {
      width += options.overflowRef.value?.offsetWidth ?? 76
    }
    if (options.canAdd.value) width += options.addButtonWidth
    return width
  }

  function recomputeVisibleTabs() {
    if (!useDropdownOverflow.value) {
      visibleValues.value = new Set(options.items.value.map((item) => item.value))
      return
    }

    const nav = options.navRef.value
    if (!nav) return

    triggerWidths.value = measureTriggerWidths()
    const availableWidth = nav.clientWidth
    visibleValues.value = resolveVisibleTabValues(
      options.items.value,
      triggerWidths.value,
      availableWidth,
      options.activeValue.value,
      reservedWidth(),
      { keepActiveVisible: false },
    )
  }

  function updateScrollButtons() {
    const viewport = navViewportRef.value
    if (!viewport || !useScrollOverflow.value) {
      canScrollPrev.value = false
      canScrollNext.value = false
      return
    }
    canScrollPrev.value = viewport.scrollLeft > 1
    canScrollNext.value = viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1
  }

  function scrollNav(direction: -1 | 1) {
    navViewportRef.value?.scrollBy({ left: direction * 180, behavior: 'smooth' })
  }

  function onNavScroll() {
    updateScrollButtons()
  }

  async function scrollActiveTabIntoView() {
    if (!useScrollOverflow.value) return
    await nextTick()
    const viewport = navViewportRef.value
    if (!viewport) return
    const active = viewport.querySelector<HTMLElement>(`.rs-tabs__trigger[data-state='active']`)
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
    updateScrollButtons()
  }

  function scheduleLayout() {
    nextTick(() => {
      recomputeVisibleTabs()
      updateScrollButtons()
      if (!useDropdownOverflow.value) return
      nextTick(() => {
        recomputeVisibleTabs()
        updateScrollButtons()
      })
    })
  }

  onMounted(() => {
    scheduleLayout()
    const nav = options.navRef.value
    if (!nav || typeof ResizeObserver === 'undefined') return
    resizeObserver = new ResizeObserver(() => scheduleLayout())
    resizeObserver.observe(nav)
  })

  onUnmounted(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
  })

  watch(
    () => [options.items.value, options.overflow.value, options.canAdd.value] as const,
    () => scheduleLayout(),
    { deep: true },
  )

  watch(options.activeValue, () => {
    scheduleLayout()
    void scrollActiveTabIntoView()
  })

  return {
    navViewportRef,
    useDropdownOverflow,
    useScrollOverflow,
    visibleTabItems,
    hiddenItems,
    overflowMenuItems,
    activeInHidden,
    showOverflowMenu,
    canScrollPrev,
    canScrollNext,
    scrollNav,
    onNavScroll,
    scheduleLayout,
  }
}
