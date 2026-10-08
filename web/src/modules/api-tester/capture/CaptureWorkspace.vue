<script setup lang="ts">
/**
 * 启动本机代理，把抓到的 HTTP 请求存进集合。HTTPS 只看到目标主机。
 */
import { RsButton, RsInput } from '@niuma/ui'
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiCaptureApi, type ApiCaptureEntry } from '@/api/api-capture'
import { useApiTesterStore } from '../stores/api-tester'
import { minimalRequest } from '../utils/collection-io'

const { t } = useI18n()
const api = useApiTesterStore()
const port = ref('8899')
const listening = ref('')
const entries = ref<ApiCaptureEntry[]>([])
let timer: ReturnType<typeof setInterval> | undefined

async function start(): Promise<void> {
  const started = await apiCaptureApi.start({ host: '127.0.0.1', port: Number(port.value) || 0 })
  listening.value = started.listenAddr
  await refresh()
  timer = setInterval(() => void refresh(), 1500)
}

async function stop(): Promise<void> {
  if (timer) clearInterval(timer)
  timer = undefined
  await apiCaptureApi.stop()
  listening.value = ''
}

async function refresh(): Promise<void> {
  const result = await apiCaptureApi.log()
  entries.value = result.entries ?? []
}

function save(entry: ApiCaptureEntry): void {
  const req = minimalRequest({
    name: `${entry.method} ${entry.url}`,
    method: entry.method === 'POST' || entry.method === 'PUT' || entry.method === 'PATCH' || entry.method === 'DELETE' || entry.method === 'HEAD' ? entry.method : 'GET',
    url: entry.url,
    body: entry.body,
    bodyMode: entry.body.trim() ? 'raw' : 'none',
    headers: entry.headers.map((row, index) => ({
      id: `cap-${index}`,
      enabled: true,
      key: row.name,
      value: row.value,
    })),
  })
  api.addPreparedRequest(req)
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="nm-api-cap">
    <header class="nm-api-cap__bar">
      <RsInput v-model="port" size="sm" :disabled="!!listening" :placeholder="t('modules.api.capturePort')" />
      <RsButton v-if="!listening" size="sm" variant="text" tone="success" icon="play" @click="start">
        {{ t('modules.api.captureStart') }}
      </RsButton>
      <RsButton v-else size="sm" variant="text" tone="danger" icon="square" @click="stop">
        {{ t('modules.api.captureStop') }}
      </RsButton>
      <span v-if="listening" class="nm-api-cap__addr">{{ listening }}</span>
    </header>
    <p class="nm-api-cap__hint">{{ t('modules.api.captureHint') }}</p>
    <p v-if="!entries.length" class="nm-api-cap__hint">{{ t('modules.api.captureEmpty') }}</p>
    <ul class="nm-api-cap__list">
      <li v-for="entry in entries" :key="entry.id" class="nm-api-cap__item">
        <span class="nm-api-cap__method">{{ entry.method }}</span>
        <span class="nm-api-cap__url">{{ entry.url }}</span>
        <RsButton size="sm" variant="ghost" @click="save(entry)">{{ t('modules.api.captureSave') }}</RsButton>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.nm-api-cap {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-api-cap__bar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  height: var(--nm-tabbar-h);
  padding: 0 var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-cap__bar > :deep(.rs-input) {
  width: 6rem;
}

.nm-api-cap__addr,
.nm-api-cap__hint {
  margin: 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.nm-api-cap__hint {
  padding: var(--rs-space-xs) var(--rs-space-md);
}

.nm-api-cap__list {
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.nm-api-cap__item {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-height: 1.75rem;
  padding: 0 var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-sm);
}

.nm-api-cap__url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
