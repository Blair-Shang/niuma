<script setup lang="ts">
import RsIcon from './RsIcon.vue'

defineProps<{
  label: string
  icon?: string
  active?: boolean
  disabled?: boolean
  collapsed?: boolean
}>()
</script>

<template>
  <button
    type="button"
    class="rs-sidebar-item"
    :class="{ 'rs-sidebar-item--active': active, 'rs-sidebar-item--collapsed': collapsed }"
    :disabled="disabled"
    :title="collapsed ? label : undefined"
  >
    <RsIcon v-if="icon" :name="icon" class="rs-sidebar-item__icon" />
    <span v-if="!collapsed" class="rs-sidebar-item__label">{{ label }}</span>
    <slot />
  </button>
</template>

<style scoped>
.rs-sidebar-item {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  width: 100%;
  min-height: var(--rs-control-height-md);
  box-sizing: border-box;
  padding: 0 var(--rs-space-sm);
  border: 1px solid transparent;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  font: inherit;
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    border-color var(--rs-transition-fast),
    color var(--rs-transition-fast);
}
.rs-sidebar-item:hover:not(:disabled) {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}
.rs-sidebar-item--active {
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
  color: var(--rs-primary);
}
.rs-sidebar-item--collapsed {
  justify-content: center;
  padding: 0;
}
.rs-sidebar-item:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.rs-sidebar-item__icon {
  flex: 0 0 auto;
}
.rs-sidebar-item__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
