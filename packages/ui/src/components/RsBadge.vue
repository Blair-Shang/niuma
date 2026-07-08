<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
  }>(),
  {
    variant: 'default',
  },
)
</script>

<template>
  <span class="rs-badge" :class="`rs-badge--${variant}`">
    <slot />
  </span>
</template>

<style scoped>
.rs-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.625rem;
  border-radius: var(--rs-radius-full);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  line-height: var(--rs-line-height-tight);
  letter-spacing: 0.02em;
}
.rs-badge--default {
  background: var(--rs-surface-hover);
  color: var(--rs-text);
  border: 1px solid var(--rs-border);
}
.rs-badge--primary {
  background: var(--rs-primary-container);
  color: var(--rs-on-primary-container);
  border: 1px solid color-mix(in srgb, var(--rs-primary) 40%, transparent);
}
.rs-badge--success {
  background: var(--rs-success-container);
  color: var(--rs-on-success-container);
  border: 1px solid color-mix(in srgb, var(--rs-success) 40%, transparent);
}
.rs-badge--warning {
  background: var(--rs-warning-container);
  color: var(--rs-on-warning-container);
  border: 1px solid color-mix(in srgb, var(--rs-warning) 40%, transparent);
}
.rs-badge--danger {
  background: var(--rs-danger-container);
  color: var(--rs-on-danger-container);
  border: 1px solid color-mix(in srgb, var(--rs-danger) 40%, transparent);
}
.rs-badge--info {
  background: var(--rs-info-container);
  color: var(--rs-on-info-container);
  border: 1px solid color-mix(in srgb, var(--rs-info) 40%, transparent);
}
</style>
