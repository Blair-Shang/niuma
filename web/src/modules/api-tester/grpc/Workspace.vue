<script setup lang="ts">
/**
 * gRPC unary。地址和服务方法在本页，发送走集合里的同一条请求。
 */
import { RsButton, RsInput, RsLabel } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRequest } from '../types'
import { useApiTesterStore } from '../stores/api-tester'
import ApiResponsePane from '../http/components/ApiResponsePane.vue'

const props = defineProps<{
  request: ApiRequest
  requestId?: string
}>()

const { t } = useI18n()
const api = useApiTesterStore()
const sending = computed(() => Boolean(props.requestId && api.sending[props.requestId]))
const exchange = computed(() => (props.requestId ? api.exchanges[props.requestId] ?? null : null))

const serviceMethod = computed({
  get: () => props.request.grpcMethod ?? '',
  set: (value: string) => {
    props.request.grpcMethod = value
  },
})

function send(): void {
  if (props.requestId) void api.send(props.requestId)
}
</script>

<template>
  <div class="nm-api-grpc">
    <div class="nm-api-grpc__form">
      <p class="nm-api-grpc__hint">{{ t('modules.api.grpcHint') }}</p>
      <div class="nm-api-grpc__field">
        <RsLabel>{{ t('modules.api.grpcServer') }}</RsLabel>
        <RsInput v-model="request.url" size="sm" spellcheck="false" placeholder="localhost:50051" />
      </div>
      <div class="nm-api-grpc__field">
        <RsLabel>{{ t('modules.api.grpcMethod') }}</RsLabel>
        <RsInput v-model="serviceMethod" size="sm" spellcheck="false" placeholder="package.Service/Method" />
      </div>
      <div class="nm-api-grpc__field nm-api-grpc__field--body">
        <RsLabel>JSON</RsLabel>
        <textarea v-model="request.body" class="nm-api-grpc__text" spellcheck="false" />
      </div>
      <RsButton size="sm" variant="text" tone="success" icon="play" :disabled="sending" @click="send">
        {{ t('modules.api.send') }}
      </RsButton>
    </div>
    <ApiResponsePane :exchange="exchange" :sending="sending" />
  </div>
</template>

<style scoped>
.nm-api-grpc {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-api-grpc__form {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-grpc__hint {
  margin: 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.nm-api-grpc__field--body {
  min-height: 8rem;
}

.nm-api-grpc__text {
  width: 100%;
  min-height: 7rem;
  resize: vertical;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  color: var(--rs-text);
  font: inherit;
  padding: var(--rs-space-xs);
}
</style>
