<script setup lang="ts">
import { RsButton, codeEditorLanguageLabel } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileDocument } from '@/modules/file-editor/types'

const props = defineProps<{
  document: FileDocument | null
}>()

const emit = defineEmits<{
  save: []
  toggleReadonly: []
}>()

const { t } = useI18n()

const languageLabel = computed(() =>
  props.document ? codeEditorLanguageLabel(props.document.language) : '—',
)

const dirty = computed(
  () => props.document != null && props.document.content !== props.document.savedContent,
)

const canSave = computed(
  () =>
    props.document != null
    && !props.document.readonly
    && props.document.status !== 'loading'
    && props.document.status !== 'saving'
    && dirty.value,
)

const saving = computed(() => props.document?.status === 'saving')
</script>

<template>
  <div class="nm-fe-toolbar nm-no-drag">
    <span class="nm-fe-toolbar__lang">{{ languageLabel }}</span>
    <button
      v-if="document"
      type="button"
      class="nm-fe-toolbar__mode"
      @click="emit('toggleReadonly')"
    >
      {{ document.readonly ? t('fileEditor.readonly') : t('fileEditor.edit') }}
    </button>
    <div class="nm-fe-toolbar__spacer" />
    <RsButton
      variant="primary"
      size="sm"
      :disabled="!canSave"
      :loading="saving"
      @click="emit('save')"
    >
      {{ t('fileEditor.save') }}
    </RsButton>
  </div>
</template>

<style scoped>
.nm-fe-toolbar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-xs) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-xs);
}

.nm-fe-toolbar__lang {
  color: var(--rs-muted);
}

.nm-fe-toolbar__mode {
  padding: 2px 8px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm, 4px);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
}

.nm-fe-toolbar__mode:hover {
  color: var(--rs-text);
  border-color: var(--rs-border);
}

.nm-fe-toolbar__spacer {
  flex: 1;
}
</style>
