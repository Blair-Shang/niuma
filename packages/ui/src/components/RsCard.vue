<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { Primitive } from './reka'

const props = withDefaults(
  defineProps<{
    as?: string
    title?: string
    description?: string
    padding?: boolean
    elevated?: boolean
  }>(),
  {
    as: 'section',
    padding: true,
    elevated: false,
  },
)

const slots = useSlots()
const hasHeader = computed(() => Boolean(props.title || props.description || slots.header))
</script>

<template>
  <Primitive
    :as="as"
    class="rs-card"
    :class="{ 'rs-card--elevated': elevated }"
  >
    <header v-if="hasHeader" class="rs-card__header">
      <div class="rs-card__heading">
        <slot name="header">
          <h3 v-if="title" class="rs-card__title">{{ title }}</h3>
          <p v-if="description" class="rs-card__description">{{ description }}</p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="rs-card__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="rs-card__body" :class="{ 'rs-card__body--padded': padding }">
      <slot />
    </div>
  </Primitive>
</template>

<style>
.rs-card {
  border-radius: var(--rs-radius);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface);
}
.rs-card--elevated {
  box-shadow: var(--rs-shadow-sm);
}
.rs-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--rs-border-subtle);
}
.rs-card__title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}
.rs-card__description {
  margin: 0.25rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: var(--rs-line-height-normal);
}
.rs-card__actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.rs-card__body--padded {
  padding: 1.25rem;
}
</style>
