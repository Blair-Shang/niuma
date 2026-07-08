<script setup lang="ts">
import { RsIcon } from '@niuma/ui'
import type { FileDocument } from '@/modules/file-editor/types'

defineProps<{
  documents: FileDocument[]
  activeDocId: string | null
}>()

const emit = defineEmits<{
  activate: [docId: string]
  close: [docId: string]
}>()

function isDirty(doc: FileDocument): boolean {
  return doc.content !== doc.savedContent
}
</script>

<template>
  <div class="nm-fe-tabbar nm-no-drag" role="tablist">
    <button
      v-for="doc in documents"
      :key="doc.docId"
      type="button"
      class="nm-fe-tabbar__tab"
      :class="{ 'nm-fe-tabbar__tab--active': doc.docId === activeDocId }"
      role="tab"
      :aria-selected="doc.docId === activeDocId"
      @click="emit('activate', doc.docId)"
      @mouseup.middle.prevent="emit('close', doc.docId)"
    >
      <span v-if="isDirty(doc)" class="nm-fe-tabbar__dirty" aria-hidden="true">●</span>
      <span class="nm-fe-tabbar__label">{{ doc.label }}</span>
      <button
        type="button"
        class="nm-fe-tabbar__close"
        :aria-label="$t('fileEditor.closeTab')"
        @click.stop="emit('close', doc.docId)"
      >
        <RsIcon name="x" :size="12" />
      </button>
    </button>
  </div>
</template>

<style scoped>
.nm-fe-tabbar {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  gap: 2px;
}

.nm-fe-tabbar__tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 12rem;
  padding: 0 8px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
  white-space: nowrap;
}

.nm-fe-tabbar__tab--active {
  color: var(--rs-text);
  border-bottom-color: var(--rs-primary);
  background: color-mix(in srgb, var(--rs-primary) 6%, transparent);
}

.nm-fe-tabbar__dirty {
  color: var(--rs-warning);
  font-size: 10px;
  line-height: 1;
}

.nm-fe-tabbar__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.nm-fe-tabbar__close {
  display: inline-flex;
  padding: 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
}

.nm-fe-tabbar__close:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--rs-text) 10%, transparent);
}
</style>
