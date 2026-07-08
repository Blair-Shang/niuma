<script setup lang="ts">
defineProps<{
  description: string
  title?: string
}>()
</script>

<template>
  <div class="rs-empty">
    <div class="rs-empty__icon">
      <slot name="icon" />
    </div>
    <div class="rs-empty__text">
      <p v-if="title" class="rs-empty__title">{{ title }}</p>
      <p class="rs-empty__description" :class="{ 'rs-empty__description--offset': title }">
        {{ description }}
      </p>
    </div>
    <slot />
  </div>
</template>

<style>
.rs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 3.5rem 1.5rem;
  border-radius: var(--rs-radius);
  border: 1px dashed var(--rs-border);
  background: color-mix(in srgb, var(--rs-surface) 80%, var(--rs-bg));
  text-align: center;
}
.rs-empty__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: var(--rs-radius-full);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface);
  color: var(--rs-muted);
  box-shadow: var(--rs-shadow-sm);
}
.rs-empty__title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 500;
  color: var(--rs-text);
}
.rs-empty__description {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
  line-height: var(--rs-line-height-normal);
}
.rs-empty__description--offset {
  margin-top: 0.25rem;
}
</style>
