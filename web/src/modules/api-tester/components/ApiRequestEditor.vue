<script setup lang="ts">
import { RsCodeEditor, RsTabs, type RsTabItem } from '@niuma/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import type { ApiRequest } from '../types'
import ApiKvEditor from './ApiKvEditor.vue'

const props = defineProps<{
  request: ApiRequest
}>()

const { t } = useI18n()
const appStore = useAppStore()
const tab = ref('params')

const items = computed<RsTabItem[]>(() => [
  { value: 'params', label: t('modules.api.params') },
  { value: 'headers', label: t('modules.api.headers') },
  { value: 'body', label: t('modules.api.body') },
])

const bodyModel = computed({
  get: () => props.request.body,
  set: (value: string) => {
    props.request.body = value
  },
})
</script>

<template>
  <div class="nm-api-req">
    <RsTabs
      v-model="tab"
      :items="items"
      size="sm"
      variant="line"
      panelless
      borderless
      content-gap="none"
    />
    <ApiKvEditor v-if="tab === 'params'" v-model="request.params" />
    <ApiKvEditor v-else-if="tab === 'headers'" v-model="request.headers" />
    <RsCodeEditor
      v-else
      v-model="bodyModel"
      language="json"
      :theme="appStore.theme"
      :show-toolbar="false"
      embedded
      height="100%"
    />
  </div>
</template>

<style scoped>
.nm-api-req {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.nm-api-req :deep(.rs-tabs) {
  flex-shrink: 0;
  padding: 0 0.5rem;
}

.nm-api-req :deep(.rs-code-editor) {
  flex: 1;
  min-height: 0;
}
</style>
