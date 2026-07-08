<script setup lang="ts">
withDefaults(
  defineProps<{
    forId?: string
    required?: boolean
    hint?: string
    disabled?: boolean
  }>(),
  {
    required: false,
    disabled: false,
  },
)
</script>

<template>
  <label
    class="rs-label"
    :class="{ 'rs-label--disabled': disabled }"
    :for="forId"
  >
    <span class="rs-label__text">
      <slot />
      <span v-if="required" class="rs-label__required" aria-hidden="true">*</span>
    </span>
    <span v-if="hint" class="rs-label__hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.rs-label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}
.rs-label--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.rs-label__text {
  font-weight: 500;
}
.rs-label__required {
  margin-left: 0.125rem;
  color: var(--rs-danger);
}
.rs-label__hint {
  font-size: var(--rs-font-size-xs);
  font-weight: 400;
  color: var(--rs-muted);
}
</style>
