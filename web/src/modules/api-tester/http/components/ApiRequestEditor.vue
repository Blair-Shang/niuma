<script setup lang="ts">
import { RsTabs, type RsTabItem } from '@niuma/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiKvRow, ApiRequest } from '../../types'
import ApiKvEditor from '../../layout/ApiKvEditor.vue'
import ApiScriptPane from '../../script/ApiScriptPane.vue'
import ApiBodyEditor from './ApiBodyEditor.vue'
import ApiRequestAuth from './ApiRequestAuth.vue'

const props = defineProps<{
  request: ApiRequest
}>()

const { t } = useI18n()
const tab = ref('params')

function filledCount(rows: ApiKvRow[] | undefined): number | undefined {
  const count = (rows ?? []).filter((row) => row.enabled && row.key.trim()).length
  return count > 0 ? count : undefined
}

const items = computed<RsTabItem[]>(() => [
  { value: 'params', label: t('modules.api.params'), badge: filledCount(props.request.params) },
  { value: 'auth', label: t('modules.api.auth') },
  { value: 'headers', label: t('modules.api.headers'), badge: filledCount(props.request.headers) },
  {
    value: 'body',
    label: t('modules.api.body'),
    badge: props.request.bodyMode !== 'none' ? 1 : undefined,
  },
  {
    value: 'script',
    label: t('modules.api.script'),
    badge: scriptCount(),
  },
])

function scriptCount(): number | undefined {
  const steps = (props.request.preSteps ?? []).filter((row) => row.enabled && row.key.trim()).length
  const checks = (props.request.checks ?? []).filter((row) => row.enabled).length
  const count = steps + checks
  return count > 0 ? count : undefined
}
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
    <div class="nm-api-req__body">
      <ApiKvEditor v-if="tab === 'params'" v-model="request.params" table />
      <ApiKvEditor v-else-if="tab === 'headers'" v-model="request.headers" table />
      <ApiRequestAuth v-else-if="tab === 'auth'" :request="request" />
      <ApiBodyEditor v-else-if="tab === 'body'" :request="request" />
      <ApiScriptPane v-else :request="request" />
    </div>
  </div>
</template>

<style scoped>
.nm-api-req {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: var(--rs-surface);
}

.nm-api-req > :deep(.rs-tabs) {
  flex-shrink: 0;
  padding: 0 var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-req__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.nm-api-req__body > * {
  flex: 1;
  min-height: 0;
}
</style>
