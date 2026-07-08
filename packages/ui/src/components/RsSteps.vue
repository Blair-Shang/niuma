<script setup lang="ts">
import { computed } from 'vue'
import type { RsStepItem, RsStepsOrientation, RsStepsSize } from './steps-utils'
import { resolveStepStatus } from './steps-utils'

const model = defineModel<string>()

const props = withDefaults(
  defineProps<{
    items: RsStepItem[]
    orientation?: RsStepsOrientation
    size?: RsStepsSize
    clickable?: boolean
  }>(),
  {
    orientation: 'horizontal',
    size: 'md',
    clickable: false,
  },
)

const activeIndex = computed(() => Math.max(0, props.items.findIndex((item) => item.value === model.value)))

function selectStep(item: RsStepItem): void {
  if (!props.clickable || item.disabled) return
  model.value = item.value
}
</script>

<template>
  <ol class="rs-steps" :class="[`rs-steps--${orientation}`, `rs-steps--${size}`]">
    <li
      v-for="(item, index) in items"
      :key="item.value"
      class="rs-steps__item"
      :class="`rs-steps__item--${resolveStepStatus(index, activeIndex, item.status)}`"
    >
      <button
        type="button"
        class="rs-steps__trigger"
        :disabled="!clickable || item.disabled"
        @click="selectStep(item)"
      >
        <span class="rs-steps__indicator">{{ index + 1 }}</span>
        <span class="rs-steps__body">
          <span class="rs-steps__title">{{ item.title }}</span>
          <span v-if="item.description" class="rs-steps__description">{{ item.description }}</span>
        </span>
      </button>
      <span v-if="index < items.length - 1" class="rs-steps__separator" />
    </li>
  </ol>
</template>

<style scoped>
.rs-steps {
  display: flex;
  gap: var(--rs-space-md);
  margin: 0;
  padding: 0;
  list-style: none;
}
.rs-steps--vertical {
  flex-direction: column;
}
.rs-steps__item {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--rs-space-md);
  min-width: 0;
}
.rs-steps--vertical .rs-steps__item {
  align-items: flex-start;
}
.rs-steps__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}
.rs-steps__trigger:not(:disabled) {
  cursor: pointer;
}
.rs-steps__indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  flex: 0 0 auto;
  border-radius: var(--rs-radius-full);
  background: var(--rs-surface-hover);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 700;
}
.rs-steps--sm .rs-steps__indicator {
  width: 1.5rem;
  height: 1.5rem;
}
.rs-steps__item--finish .rs-steps__indicator,
.rs-steps__item--process .rs-steps__indicator {
  background: var(--rs-primary);
  color: var(--rs-primary-foreground);
}
.rs-steps__item--error .rs-steps__indicator {
  background: var(--rs-danger-container);
  color: var(--rs-on-danger-container);
}
.rs-steps__body {
  display: grid;
  min-width: 0;
}
.rs-steps__title {
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}
.rs-steps__description {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}
.rs-steps__separator {
  height: 1px;
  flex: 1;
  background: var(--rs-border);
}
.rs-steps--vertical .rs-steps__separator {
  width: 1px;
  min-height: 1.5rem;
  margin-left: 0.875rem;
}
</style>
