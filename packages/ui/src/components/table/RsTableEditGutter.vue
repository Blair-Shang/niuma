<script setup lang="ts">
import RsIcon from '../RsIcon.vue'

defineProps<{
  lineNumber: number
  pending: boolean
  commitLabel?: string
  commitHint?: string
  rollbackLabel?: string
  showRollback?: boolean
}>()

const emit = defineEmits<{
  commit: []
  rollback: []
}>()
</script>

<template>
  <div
    class="rs-table-edit-gutter"
    :class="{ 'rs-table-edit-gutter--pending': pending }"
  >
    <span
      class="rs-table-edit-gutter__line"
      :class="{ 'rs-table-edit-gutter__line--hidden': pending }"
      aria-hidden="true"
    >
      {{ lineNumber }}
    </span>
    <div v-if="pending" class="rs-table-edit-gutter__actions">
      <button
        type="button"
        class="rs-table-edit-gutter__commit"
        :aria-label="commitLabel"
        :title="commitLabel"
        @click.stop="emit('commit')"
      >
        <RsIcon name="check" :size="12" />
        <span class="rs-table-edit-gutter__commit-hint">{{ commitHint ?? commitLabel }}</span>
      </button>
      <button
        v-if="showRollback"
        type="button"
        class="rs-table-edit-gutter__rollback"
        :aria-label="rollbackLabel"
        :title="rollbackLabel"
        @click.stop="emit('rollback')"
      >
        <RsIcon name="x" :size="12" />
      </button>
    </div>
  </div>
</template>
