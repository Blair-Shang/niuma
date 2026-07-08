<script setup lang="ts">
defineProps<{
  title?: string
  collapsed?: boolean
}>()
</script>

<template>
  <section class="rs-sidebar-group">
    <div v-if="title && !collapsed" class="rs-sidebar-group__title">{{ title }}</div>
    <div class="rs-sidebar-group__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.rs-sidebar-group + .rs-sidebar-group {
  margin-top: var(--rs-space-md);
}
.rs-sidebar-group__title {
  padding: var(--rs-space-xs) var(--rs-space-sm);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.rs-sidebar-group__body {
  display: grid;
  gap: var(--rs-space-xs);
}
</style>
