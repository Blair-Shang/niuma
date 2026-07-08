<script setup lang="ts">
defineProps<{
  title?: string
}>()
</script>

<template>
  <section class="demo-block">
    <header v-if="title" class="demo-block__header">
      <h2 class="demo-block__title">{{ title }}</h2>
    </header>
    <div class="demo-block__panel">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.demo-block__header {
  margin-bottom: var(--rs-space-sm);
}

.demo-block__title {
  margin: 0;
  padding-inline: var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  line-height: var(--rs-line-height-normal);
  letter-spacing: 0.02em;
  color: var(--rs-muted);
}

.demo-block__panel {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding: var(--rs-space-lg);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius);
  background: var(--rs-surface);
}

/* 暗色：靠描边与层级分层，不加投影 */
:global([data-rs-theme='dark']) .demo-block__panel {
  background: var(--rs-surface-elevated);
  border-color: var(--rs-border-subtle);
}
</style>
