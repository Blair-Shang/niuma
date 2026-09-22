<script setup lang="ts">
import { RsCodeEditor, RsSelect, type RsSelectOption } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import type { ApiBodyMode, ApiRequest } from '../types'
import ApiKvEditor from '../layout/ApiKvEditor.vue'

const props = defineProps<{
  request: ApiRequest
}>()

const { t } = useI18n()
const appStore = useAppStore()

const modeOptions = computed<RsSelectOption[]>(() => [
  { value: 'none', label: t('modules.api.bodyNone') },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Text' },
  { value: 'raw', label: 'Raw' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'form', label: 'form-data' },
])

const bodyMode = computed({
  get: () => props.request.bodyMode,
  set: (value: string) => {
    props.request.bodyMode = value as ApiBodyMode
    if (!props.request.bodyForm) props.request.bodyForm = []
  },
})

const bodyModel = computed({
  get: () => props.request.body,
  set: (value: string) => {
    props.request.body = value
  },
})

const bodyFormModel = computed({
  get: () => props.request.bodyForm ?? [],
  set: (value) => {
    props.request.bodyForm = value
  },
})

const editorLanguage = computed(() => {
  if (props.request.bodyMode === 'json') return 'json'
  return 'plaintext'
})
</script>

<template>
  <div class="nm-api-body">
    <div class="nm-api-body__mode">
      <RsSelect
        v-model="bodyMode"
        :options="modeOptions"
        size="sm"
        radius="sm"
        :searchable="false"
        :clearable="false"
        :filter-option="false"
      />
    </div>

    <div v-if="bodyMode === 'none'" class="nm-api-body__empty">{{ t('modules.api.bodyNoneHint') }}</div>

    <ApiKvEditor
      v-else-if="bodyMode === 'urlencoded' || bodyMode === 'form'"
      v-model="bodyFormModel"
    />

    <RsCodeEditor
      v-else
      v-model="bodyModel"
      :language="editorLanguage"
      :theme="appStore.editorTheme"
      :show-toolbar="false"
      embedded
      height="100%"
    />
  </div>
</template>

<style scoped>
.nm-api-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.nm-api-body__mode {
  flex-shrink: 0;
  padding: 0.375rem 0.75rem 0;
}

.nm-api-body__empty {
  padding: 0.75rem;
  color: var(--rs-text-muted);
  font-size: var(--rs-font-size-xs);
}

.nm-api-body :deep(.rs-code-editor) {
  flex: 1;
  min-height: 0;
}
</style>
