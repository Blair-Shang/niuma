<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileDocument } from '@/modules/file-editor/types'

const props = defineProps<{
  document: FileDocument | null
}>()

const { t } = useI18n()

const statusText = computed(() => {
  const doc = props.document
  if (!doc) {
    return t('fileEditor.empty')
  }
  if (doc.status === 'loading') {
    return t('fileEditor.loading')
  }
  if (doc.status === 'saving') {
    return t('fileEditor.saving')
  }
  if (doc.status === 'error') {
    return doc.error ?? t('fileEditor.loadError')
  }
  if (doc.content !== doc.savedContent) {
    return '●'
  }
  return t('fileEditor.saved')
})
</script>

<template>
  <div class="nm-fe-statusbar nm-no-drag">
    <span class="nm-fe-statusbar__path">{{ document?.sourceLabel ?? '—' }}</span>
    <span class="nm-fe-statusbar__state">{{ statusText }}</span>
  </div>
</template>

<style scoped>
.nm-fe-statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: 2px var(--rs-space-md);
  border-top: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-fe-statusbar__path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
