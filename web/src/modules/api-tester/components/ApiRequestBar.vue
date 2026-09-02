<script setup lang="ts">
import { RsButton, RsInput, RsSelect, type RsSelectOption } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiEnvironment, ApiMethod, ApiRequest } from '../types'
import { applyPaneMethod } from '../pane-registry'

const props = defineProps<{
  request: ApiRequest
  environments: ApiEnvironment[]
  sending?: boolean
  live?: boolean
}>()

const { t } = useI18n()

const urlPlaceholder = computed(() =>
  props.request.method === 'TCP' || props.request.method === 'UDP'
    ? t('modules.api.urlPlaceholderSocket')
    : '{{baseUrl}}/api/...',
)

const envId = defineModel<string>('envId', { default: '' })

const emit = defineEmits<{
  send: []
  cancel: []
  close: []
  copyCurl: []
}>()

const methods: ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'WS', 'TCP', 'UDP']

const methodOptions = computed<RsSelectOption[]>(() =>
  methods.map((method) => ({ value: method, label: method })),
)

const envOptions = computed<RsSelectOption[]>(() =>
  props.environments.map((item) => ({ value: item.id, label: item.name })),
)

const methodModel = computed({
  get: () => props.request.method,
  set: (value: string) => {
    applyPaneMethod(props.request, value as ApiMethod)
  },
})
</script>

<template>
  <div class="nm-api-bar">
    <RsSelect
      v-model="methodModel"
      :options="methodOptions"
      size="sm"
      radius="sm"
      :searchable="false"
      :clearable="false"
      :filter-option="false"
      class="nm-api-bar__method"
      :class="`nm-api-bar__method--${request.method.toLowerCase()}`"
    />
    <RsInput
      v-model="request.url"
      size="sm"
      radius="sm"
      class="nm-api-bar__url"
      :placeholder="urlPlaceholder"
      spellcheck="false"
    />
    <RsSelect
      v-model="envId"
      :options="envOptions"
      size="sm"
      radius="sm"
      :searchable="false"
      :clearable="false"
      :filter-option="false"
      :aria-label="t('modules.api.environment')"
      class="nm-api-bar__env"
    />
    <RsButton
      v-if="sending"
      variant="default"
      size="sm"
      @click="emit('cancel')"
    >
      {{ t('modules.api.cancel') }}
    </RsButton>
    <template v-else>
      <RsButton
        variant="primary"
        size="sm"
        :disabled="!request.url.trim()"
        @click="emit('send')"
      >
        {{ t('modules.api.send') }}
      </RsButton>
      <RsButton
        v-if="live"
        variant="default"
        size="sm"
        @click="emit('close')"
      >
        {{ t('modules.api.closeSocket') }}
      </RsButton>
    </template>
    <RsButton
      variant="ghost"
      size="sm"
      icon-only
      icon="copy"
      radius="sm"
      :aria-label="t('modules.api.copyCurl')"
      @click="emit('copyCurl')"
    />
  </div>
</template>

<style scoped>
.nm-api-bar {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-api-bar__method {
  width: 6.25rem;
  flex-shrink: 0;
}

.nm-api-bar__method :deep(.rs-select__single-label) {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
}

.nm-api-bar__method--get :deep(.rs-select__single-label) {
  color: var(--rs-success);
}

.nm-api-bar__method--post :deep(.rs-select__single-label),
.nm-api-bar__method--ws :deep(.rs-select__single-label) {
  color: var(--rs-primary);
}

.nm-api-bar__method--put :deep(.rs-select__single-label),
.nm-api-bar__method--patch :deep(.rs-select__single-label) {
  color: var(--rs-warning);
}

.nm-api-bar__method--delete :deep(.rs-select__single-label) {
  color: var(--rs-danger);
}

.nm-api-bar__url {
  flex: 1;
  min-width: 0;
}

.nm-api-bar__url :deep(input) {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
}

.nm-api-bar__env {
  width: 8.5rem;
  flex-shrink: 0;
}
</style>
