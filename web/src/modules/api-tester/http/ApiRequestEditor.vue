<script setup lang="ts">
import { RsTabs, type RsTabItem } from '@niuma/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRequest } from '../types'
import ApiKvEditor from '../layout/ApiKvEditor.vue'
import ApiBodyEditor from './ApiBodyEditor.vue'
import ApiRequestAuth from './ApiRequestAuth.vue'

const props = defineProps<{
  request: ApiRequest
}>()

const { t } = useI18n()
const tab = ref('params')

const items = computed<RsTabItem[]>(() => [
  { value: 'params', label: t('modules.api.params') },
  { value: 'headers', label: t('modules.api.headers') },
  { value: 'auth', label: t('modules.api.auth') },
  { value: 'body', label: t('modules.api.body') },
])
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
    <ApiRequestAuth v-else-if="tab === 'auth'" :request="request" />
    <ApiBodyEditor v-else :request="request" />
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
</style>
