<script setup lang="ts">
import { computed } from 'vue'
import { methodTone } from '../utils/format'
import type { ApiMethod } from '../types'

const props = withDefaults(
  defineProps<{
    method: ApiMethod | string
    compact?: boolean
  }>(),
  { compact: false },
)

const tone = computed(() => methodTone(props.method))
</script>

<template>
  <span
    class="nm-api-method"
    :class="[`nm-api-method--${tone}`, { 'nm-api-method--compact': compact }]"
  >{{ method }}</span>
</template>

<style scoped>
.nm-api-method {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 3.25rem;
  padding: 0 0.35rem;
  border-radius: var(--rs-radius-xs);
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1.4;
}

.nm-api-method--compact {
  min-width: 2.25rem;
  padding: 0 0.2rem;
  font-size: 9px;
}

.nm-api-method--get {
  color: var(--rs-success);
  background: color-mix(in srgb, var(--rs-success) 12%, transparent);
}

.nm-api-method--post {
  color: var(--rs-info, var(--rs-primary));
  background: color-mix(in srgb, var(--rs-info, var(--rs-primary)) 12%, transparent);
}

.nm-api-method--put {
  color: var(--rs-warning);
  background: color-mix(in srgb, var(--rs-warning) 14%, transparent);
}

.nm-api-method--delete {
  color: var(--rs-danger);
  background: color-mix(in srgb, var(--rs-danger) 12%, transparent);
}

.nm-api-method--other {
  color: var(--rs-muted);
  background: var(--rs-item-hover);
}
</style>
