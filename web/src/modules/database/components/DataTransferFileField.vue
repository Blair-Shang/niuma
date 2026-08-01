<script setup lang="ts">
import { RsIcon, RsInput, RsLabel } from '@niuma/ui'
import type { DataTransferFileFieldLabels } from '../types/data-transfer'

defineProps<{
  labels: DataTransferFileFieldLabels
  disabled?: boolean
  required?: boolean
}>()

const filePath = defineModel<string>({ required: true })

const emit = defineEmits<{
  browse: []
}>()
</script>

<template>
  <div class="nm-dt-file">
    <RsLabel :required="required">{{ labels.filePath }}</RsLabel>
    <RsInput v-model="filePath" :disabled="disabled" class="nm-dt-file__path">
      <template #suffix>
        <button
          type="button"
          class="nm-dt-file__browse"
          :aria-label="labels.browse"
          :title="labels.browse"
          :disabled="disabled"
          @pointerdown.prevent
          @click="emit('browse')"
        >
          <RsIcon name="folder-open" :size="14" />
        </button>
      </template>
    </RsInput>
  </div>
</template>

<style scoped>
.nm-dt-file {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs, 4px);
}

.nm-dt-file__path {
  width: 100%;
  min-width: 0;
}

.nm-dt-file__browse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-sm, 4px);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-dt-file__browse:hover:not(:disabled) {
  color: var(--rs-text);
  background: var(--rs-item-hover);
}

.nm-dt-file__browse:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.nm-dt-file__browse:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
