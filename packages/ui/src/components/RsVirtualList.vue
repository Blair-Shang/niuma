<script setup lang="ts" generic="T">
import { computed, onActivated, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import type { RsRadius } from '../theme/types'
import { rsRadiusCss, useResolvedRsRadius } from './resolve-radius'
import type { RsVirtualListItemSize } from './virtual-list-utils'
import { isVirtualListFillHeight, resolveItemSize, resolveVirtualListHeight } from './virtual-list-utils'

const props = withDefaults(
  defineProps<{
    items: T[]
    itemSize?: RsVirtualListItemSize
    height?: number | string
    overscan?: number
    activeIndex?: number | null
    /** keep-alive 外层可见性；变为 true 时重同步视口与 scroll 位置 */
    layoutActive?: boolean
    /** 外层圆角。直角列表传 `none`。默认 sm。 */
    radius?: RsRadius
  }>(),
  {
    itemSize: 32,
    height: 240,
    overscan: 4,
    activeIndex: null,
  },
)

const resolvedRadius = useResolvedRsRadius(() => props.radius, 'sm')

const rootRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const measuredHeight = ref(0)
const fillHeight = computed(() => isVirtualListFillHeight(props.height))
const heightStyle = computed(() => {
  const resolved = resolveVirtualListHeight(props.height)
  return resolved ? { height: resolved } : undefined
})
const rootStyle = computed(() => ({
  ...heightStyle.value,
  '--rs-virtual-list-radius': rsRadiusCss(resolvedRadius.value),
}))
const fixedItemSize = computed(() => resolveItemSize(props.itemSize))
const viewportHeightPx = computed(() => {
  if (typeof props.height === 'number' && props.height > 0) {
    return props.height
  }
  if (typeof props.height === 'string') {
    const parsed = Number.parseInt(props.height, 10)
    if (Number.isFinite(parsed) && parsed > 0 && !props.height.includes('%')) {
      return parsed
    }
  }
  if (measuredHeight.value > 0) {
    return measuredHeight.value
  }
  const el = rootRef.value
  if (el && el.clientHeight > 0) {
    return el.clientHeight
  }
  return 240
})

let resizeObserver: ResizeObserver | null = null

function syncMeasuredHeight(): void {
  const el = rootRef.value
  if (!el) {
    return
  }
  const next = el.clientHeight
  if (next > 0 && next !== measuredHeight.value) {
    measuredHeight.value = next
  }
}

function syncLayoutFromDom(): void {
  syncMeasuredHeight()
  const el = rootRef.value
  if (el) {
    scrollTop.value = el.scrollTop
  }
}

function scheduleLayoutSync(): void {
  syncLayoutFromDom()
  void nextTick(() => {
    syncLayoutFromDom()
    requestAnimationFrame(() => {
      syncLayoutFromDom()
    })
  })
}

onMounted(() => {
  scheduleLayoutSync()
  const el = rootRef.value
  if (!el || typeof ResizeObserver === 'undefined') {
    return
  }
  resizeObserver = new ResizeObserver(() => syncMeasuredHeight())
  resizeObserver.observe(el)
})

onActivated(() => {
  scheduleLayoutSync()
})

watch(
  () => props.layoutActive,
  (active) => {
    if (active) scheduleLayoutSync()
  },
  { flush: 'post' },
)

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
const startIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / fixedItemSize.value) - props.overscan))
const visibleCount = computed(
  () => Math.ceil(viewportHeightPx.value / fixedItemSize.value) + props.overscan * 2,
)
const visibleItems = computed(() =>
  props.items.slice(startIndex.value, startIndex.value + visibleCount.value).map((item, index) => ({
    item,
    index: startIndex.value + index,
  })),
)
const totalHeight = computed(() => props.items.length * fixedItemSize.value)
const offsetY = computed(() => startIndex.value * fixedItemSize.value)

function scrollToIndex(index: number) {
  const el = rootRef.value
  if (!el || index < 0 || index >= props.items.length) return
  const itemTop = index * fixedItemSize.value
  const itemBottom = itemTop + fixedItemSize.value
  const viewTop = el.scrollTop
  const viewBottom = viewTop + el.clientHeight
  if (itemTop >= viewTop && itemBottom <= viewBottom) {
    return
  }
  const maxScroll = Math.max(0, totalHeight.value - el.clientHeight)
  const centered = itemTop - (el.clientHeight - fixedItemSize.value) / 2
  el.scrollTop = Math.min(maxScroll, Math.max(0, centered))
  scrollTop.value = el.scrollTop
}

watch(
  () => [props.activeIndex, props.items.length] as const,
  async ([index, length]) => {
    if (index == null || index < 0 || length === 0) return
    await nextTick()
    requestAnimationFrame(() => scrollToIndex(index))
  },
  { immediate: true },
)

defineExpose({ scrollToIndex })
</script>

<template>
  <div
    ref="rootRef"
    class="rs-virtual-list"
    :class="{ 'rs-virtual-list--fill': fillHeight }"
    :style="rootStyle"
    @scroll="scrollTop = ($event.target as HTMLElement).scrollTop"
  >
    <div class="rs-virtual-list__spacer" :style="{ height: `${totalHeight}px` }">
      <div class="rs-virtual-list__items" :style="{ transform: `translateY(${offsetY}px)` }">
        <div
          v-for="entry in visibleItems"
          :key="entry.index"
          class="rs-virtual-list__item"
          :class="{ 'rs-virtual-list__item--active': activeIndex === entry.index }"
          :style="{ height: `${fixedItemSize}px` }"
        >
          <slot :item="entry.item" :index="entry.index">
            {{ entry.item }}
          </slot>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rs-virtual-list {
  overflow: auto;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-virtual-list-radius, var(--rs-radius-sm));
}
.rs-virtual-list--fill {
  flex: 1;
  align-self: stretch;
  width: 100%;
  min-height: 0;
  height: 0;
}
.rs-virtual-list__spacer {
  position: relative;
}
.rs-virtual-list__items {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
}
.rs-virtual-list__item {
  box-sizing: border-box;
}
.rs-virtual-list__item--active {
  background: color-mix(in srgb, var(--rs-primary) 14%, var(--rs-surface));
  box-shadow: inset 2px 0 0 var(--rs-primary);
}
</style>
