<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from './reka'
import {
  resolveScrollbarSize,
  type RsScrollbarOrientation,
  type RsScrollbarType,
} from './scrollbar-utils'

const props = withDefaults(
  defineProps<{
    type?: RsScrollbarType
    scrollHideDelay?: number
    orientation?: RsScrollbarOrientation
    height?: string | number
    maxHeight?: string | number
    minHeight?: string | number
  }>(),
  {
    type: 'hover',
    scrollHideDelay: 600,
    orientation: 'both',
    height: '14rem',
  },
)

const rootRef = useTemplateRef<InstanceType<typeof ScrollAreaRoot>>('rootRef')

const rootStyle = computed(() => {
  const style: Record<string, string> = {}
  const height = resolveScrollbarSize(props.height)
  const maxHeight = resolveScrollbarSize(props.maxHeight)
  const minHeight = resolveScrollbarSize(props.minHeight)
  if (height) style.height = height
  if (maxHeight) style.maxHeight = maxHeight
  if (minHeight) style.minHeight = minHeight
  return Object.keys(style).length > 0 ? style : undefined
})

const showVertical = computed(
  () => props.orientation === 'vertical' || props.orientation === 'both',
)
const showHorizontal = computed(
  () => props.orientation === 'horizontal' || props.orientation === 'both',
)

defineExpose({
  scrollTop: () => rootRef.value?.scrollTop(),
  scrollTopLeft: () => rootRef.value?.scrollTopLeft(),
  getViewport: () => rootRef.value?.viewport,
})
</script>

<template>
  <ScrollAreaRoot
    ref="rootRef"
    class="rs-scrollbar"
    :type="type"
    :scroll-hide-delay="scrollHideDelay"
    :style="rootStyle"
  >
    <ScrollAreaViewport class="rs-scrollbar__viewport">
      <div class="rs-scrollbar__content">
        <slot />
      </div>
    </ScrollAreaViewport>

    <ScrollAreaScrollbar
      v-if="showVertical"
      class="rs-scrollbar__bar rs-scrollbar__bar--vertical"
      orientation="vertical"
    >
      <ScrollAreaThumb class="rs-scrollbar__thumb" />
    </ScrollAreaScrollbar>

    <ScrollAreaScrollbar
      v-if="showHorizontal"
      class="rs-scrollbar__bar rs-scrollbar__bar--horizontal"
      orientation="horizontal"
    >
      <ScrollAreaThumb class="rs-scrollbar__thumb" />
    </ScrollAreaScrollbar>

    <ScrollAreaCorner v-if="showVertical && showHorizontal" class="rs-scrollbar__corner" />
  </ScrollAreaRoot>
</template>

<style>
.rs-scrollbar {
  position: relative;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
}

.rs-scrollbar__viewport {
  width: 100%;
  height: 100%;
  border-radius: inherit;
}

/* Reka 注入的 Primitive div。
   必须用 height:100% 而非 min-height:100%：
   只有父元素拥有"明确高度"时，子元素的 min-height:100% 才能解析（CSS 规范）。
   height:100% 让 Primitive 与 viewport 等高（= 明确高度），
   超出内容通过 overflow:visible 溢出 → viewport(overflow:scroll) 正常滚动。 */
.rs-scrollbar__viewport > div {
  height: 100%;
}

/* rs-scrollbar__content 同理：height:100% = Primitive 的明确高度。
   slot 内容若超出则溢出，滚动仍然工作；短内容时填满整个滚动区（空白可捕获右键）。 */
.rs-scrollbar__content {
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.rs-scrollbar__bar {
  user-select: none;
  touch-action: none;
  display: flex;
  padding: var(--rs-scrollbar-padding);
  background: transparent;
  transition: background var(--rs-transition-fast);
}

.rs-scrollbar__bar[data-orientation='vertical'] {
  width: var(--rs-scrollbar-size);
}

.rs-scrollbar__bar[data-orientation='horizontal'] {
  flex-direction: column;
  height: var(--rs-scrollbar-size);
}

.rs-scrollbar__bar:hover {
  background: color-mix(in srgb, var(--rs-border-subtle) 80%, transparent);
}

.rs-scrollbar__thumb {
  flex: 1;
  border-radius: var(--rs-radius-full);
  background: color-mix(in srgb, var(--rs-muted) 60%, transparent);
  position: relative;
  transition: background var(--rs-transition-fast);
}

.rs-scrollbar__thumb::before {
  content: '';
  position: absolute;
  inset: -0.375rem;
}

.rs-scrollbar__thumb:hover {
  background: color-mix(in srgb, var(--rs-primary) 40%, var(--rs-muted));
}

.rs-scrollbar__corner {
  background: var(--rs-surface);
}
</style>
