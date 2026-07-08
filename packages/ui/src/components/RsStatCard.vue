<script setup lang="ts">
export type RsStatAccent = 'primary' | 'success' | 'warning' | 'danger' | 'info'

withDefaults(
  defineProps<{
    label: string
    value?: string | number
    description?: string
    accent?: RsStatAccent
    loading?: boolean
  }>(),
  {
    accent: 'primary',
    loading: false,
  },
)
</script>

<template>
  <section class="rs-stat-card" :class="`rs-stat-card--${accent}`">
    <div class="rs-stat-card__accent" />
    <div class="rs-stat-card__body">
      <div class="rs-stat-card__label">{{ label }}</div>
      <div v-if="loading" class="rs-stat-card__skeleton" />
      <div v-else class="rs-stat-card__value">
        <slot name="value">{{ value }}</slot>
      </div>
      <p v-if="description" class="rs-stat-card__description">{{ description }}</p>
      <slot />
    </div>
  </section>
</template>

<style scoped>
.rs-stat-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface);
  box-shadow: var(--rs-shadow-sm);
}
.rs-stat-card__accent {
  height: 3px;
  background: var(--rs-primary);
}
.rs-stat-card--success .rs-stat-card__accent {
  background: var(--rs-success);
}
.rs-stat-card--warning .rs-stat-card__accent {
  background: var(--rs-warning);
}
.rs-stat-card--danger .rs-stat-card__accent {
  background: var(--rs-danger);
}
.rs-stat-card--info .rs-stat-card__accent {
  background: var(--rs-info);
}
.rs-stat-card__body {
  padding: var(--rs-space-lg);
}
.rs-stat-card__label {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
}
.rs-stat-card__value {
  margin-top: var(--rs-space-sm);
  color: var(--rs-text);
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.1;
}
.rs-stat-card__description {
  margin: var(--rs-space-sm) 0 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
}
.rs-stat-card__skeleton {
  width: 8rem;
  height: 2rem;
  margin-top: var(--rs-space-sm);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-hover);
}
</style>
