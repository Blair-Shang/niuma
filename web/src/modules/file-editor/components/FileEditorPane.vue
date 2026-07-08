<script setup lang="ts">
import { RsCodeEditor, RsEmpty, RsLoading } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileDocument } from '@/modules/file-editor/types'

const props = withDefaults(
  defineProps<{
    document: FileDocument | null
    /** 为 false 时延迟挂载编辑器（预构建完成后再显示，避免首显闪烁） */
    editorEnabled?: boolean
  }>(),
  { editorEnabled: true },
)

const emit = defineEmits<{
  'update:content': [content: string]
  editorReady: []
}>()

const { t } = useI18n()

const model = computed({
  get: () => props.document?.content ?? '',
  set: (v: string) => {
    if (props.document) {
      emit('update:content', v)
    }
  },
})

const loading = computed(() => props.document?.status === 'loading')
const error = computed(() => (props.document?.status === 'error' ? props.document.error : null))
const awaitingEditor = computed(
  () => props.document != null && props.document.status === 'ready' && !props.editorEnabled,
)
</script>

<template>
  <div class="nm-fe-pane">
    <RsLoading v-if="loading || awaitingEditor" class="nm-fe-pane__loading" />
    <RsEmpty
      v-else-if="!document"
      :description="t('fileEditor.empty')"
    />
    <div v-else-if="error" class="nm-fe-pane__error" role="alert">
      {{ error }}
    </div>
    <RsCodeEditor
      v-else
      v-model="model"
      class="nm-fe-pane__editor"
      :language="document.language"
      :readonly="document.readonly"
      :file-path="String(document.spec.context.path ?? '')"
      :show-toolbar="false"
      height="100%"
      @ready="emit('editorReady')"
    />
  </div>
</template>

<style scoped>
.nm-fe-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nm-fe-pane__loading,
.nm-fe-pane__error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--rs-space-lg);
  background: var(--rs-surface);
}

.nm-fe-pane__error {
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-fe-pane__editor {
  flex: 1;
  min-height: 0;
  border: none;
  border-radius: 0;
}
</style>
