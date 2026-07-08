<script setup lang="ts">
import { computed } from 'vue'
import { useRsI18n } from '../composables/useRsI18n'
import type { RsLoadingSize, RsLoadingTone, RsLoadingVariant } from './loading-utils'

const props = withDefaults(
  defineProps<{
    loading?: boolean
    variant?: RsLoadingVariant
    size?: RsLoadingSize
    tone?: RsLoadingTone
    label?: string
    showLabel?: boolean
    block?: boolean
    overlay?: boolean
    skeletonLines?: number
  }>(),
  {
    loading: true,
    variant: 'spinner',
    size: 'md',
    tone: 'primary',
    showLabel: false,
    block: false,
    overlay: false,
    skeletonLines: 4,
  },
)

const { t } = useRsI18n()

const resolvedLabel = computed(() => props.label ?? t('loading.label'))

const skeletonLines = computed(() =>
  Array.from({ length: Math.max(1, props.skeletonLines) }, (_, index) => index),
)
</script>

<template>
  <div
    v-if="loading"
    class="rs-loading"
    :class="{
      'rs-loading--block': block,
      'rs-loading--overlay': overlay,
    }"
    role="status"
    :aria-label="resolvedLabel"
  >
    <span
      v-if="variant === 'spinner'"
      class="rs-loading__spinner"
      :class="[`rs-loading__spinner--${size}`, `rs-loading__spinner--${tone}`]"
    />
    <span v-else-if="variant === 'dots'" class="rs-loading__dots" :class="`rs-loading__dots--${size}`">
      <span v-for="dot in 3" :key="dot" class="rs-loading__dot" />
    </span>
    <div v-else class="rs-loading__skeleton" :class="`rs-loading__skeleton--${size}`">
      <span v-for="line in skeletonLines" :key="line" class="rs-loading__skeleton-line" />
    </div>
    <span v-if="showLabel" class="rs-loading__label">{{ resolvedLabel }}</span>
  </div>
</template>

<style>
.rs-loading {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
}
.rs-loading--block {
  display: flex;
  justify-content: center;
  width: 100%;
  padding: 1.5rem;
}
.rs-loading--overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--rs-surface) 72%, transparent);
}
.rs-loading__spinner {
  display: inline-block;
  border-radius: var(--rs-radius-full);
  border: 2px solid color-mix(in srgb, var(--rs-muted) 30%, transparent);
  border-top-color: var(--rs-primary);
  animation: rs-loading-spin 0.7s linear infinite;
}
.rs-loading__spinner--sm {
  width: 0.875rem;
  height: 0.875rem;
}
.rs-loading__spinner--md {
  width: 1.125rem;
  height: 1.125rem;
}
.rs-loading__spinner--lg {
  width: 1.5rem;
  height: 1.5rem;
}
.rs-loading__dots {
  display: inline-flex;
  gap: 0.25rem;
}
.rs-loading__dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: var(--rs-radius-full);
  background: var(--rs-primary);
  animation: rs-loading-bounce 1s ease-in-out infinite;
}
.rs-loading__dot:nth-child(2) {
  animation-delay: 0.15s;
}
.rs-loading__dot:nth-child(3) {
  animation-delay: 0.3s;
}
.rs-loading__skeleton {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 0.5rem;
}
.rs-loading__skeleton-line {
  display: block;
  height: 0.75rem;
  border-radius: var(--rs-radius-xs);
  background: linear-gradient(
    90deg,
    var(--rs-surface-hover) 25%,
    color-mix(in srgb, var(--rs-border) 60%, transparent) 50%,
    var(--rs-surface-hover) 75%
  );
  background-size: 200% 100%;
  animation: rs-loading-shimmer 1.2s ease-in-out infinite;
}
.rs-loading__skeleton-line:last-child {
  width: 70%;
}
@keyframes rs-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes rs-loading-bounce {
  0%,
  80%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
@keyframes rs-loading-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
