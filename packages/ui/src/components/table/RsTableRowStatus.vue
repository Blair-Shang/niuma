<script setup lang="ts">
import RsIcon from '../RsIcon.vue'

defineProps<{
  dirty?: boolean
  commitLabel?: string
  rollbackLabel?: string
}>()

const emit = defineEmits<{
  commit: []
  rollback: []
}>()
</script>

<template>
  <div v-if="dirty" class="rs-table-row-status">
    <button
      type="button"
      class="rs-table-row-status__btn rs-table-row-status__btn--commit"
      :aria-label="commitLabel"
      :title="commitLabel"
      @click.stop="emit('commit')"
    >
      <RsIcon name="check" :size="14" />
    </button>
    <button
      type="button"
      class="rs-table-row-status__btn rs-table-row-status__btn--rollback"
      :aria-label="rollbackLabel"
      :title="rollbackLabel"
      @click.stop="emit('rollback')"
    >
      <RsIcon name="x" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.rs-table-row-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.125rem;
}
.rs-table-row-status__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  padding: 0;
  border: 0;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-table-muted-fg);
  cursor: pointer;
}
.rs-table-row-status__btn--commit {
  color: var(--rs-primary);
}
.rs-table-row-status__btn--commit:hover {
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
}
.rs-table-row-status__btn--rollback:hover {
  background: var(--rs-surface-hover);
  color: var(--rs-text);
}
</style>
