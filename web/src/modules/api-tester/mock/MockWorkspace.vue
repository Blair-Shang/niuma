<script setup lang="ts">
import { RsButton, RsInput, RsSelect, useRsToast, type RsSelectModelValue, type RsSelectOption } from '@niuma/ui'
import { createId } from '@/utils/id'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiMockHit } from '@/api/types/api-mock'
import { useApiTesterStore } from '../stores/api-tester'
import type { ApiMethod, ApiMockRoute, ApiMockServer } from '../types'
import { pathOfUrl } from './path'

const { t } = useI18n()
const api = useApiTesterStore()
const toast = useRsToast()
const serverId = ref('')
const hits = ref<ApiMockHit[]>([])
const busy = ref(false)

const methods: ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']

const server = computed(() => api.mockServers.find((item) => item.id === serverId.value) ?? api.mockServers[0])

const serverOptions = computed<RsSelectOption[]>(() =>
  api.mockServers.map((item) => ({ value: item.id, label: item.name })),
)

const methodOptions = computed<RsSelectOption[]>(() => methods.map((method) => ({ value: method, label: method })))

const matchOptions = computed<RsSelectOption[]>(() => [
  { value: 'exact', label: t('modules.api.mockMatchExact') },
  { value: 'prefix', label: t('modules.api.mockMatchPrefix') },
])

const requestOptions = computed<RsSelectOption[]>(() => {
  const rows: RsSelectOption[] = [{ value: '', label: t('modules.api.mockFromRequest') }]
  for (const folder of api.folders) {
    for (const req of folder.requests) {
      if (!methods.includes(req.method)) continue
      rows.push({ value: req.id, label: `${req.method} ${req.name}` })
    }
  }
  return rows
})

const listening = computed(() => (server.value ? api.mockListen[server.value.id] ?? '' : ''))

onMounted(() => {
  void api.whenReady().then(() => {
    const created = api.ensureLocalMock()
    if (!serverId.value) serverId.value = created.id
  })
})

function current(): ApiMockServer | undefined {
  return server.value
}

async function run(task: () => Promise<void>): Promise<void> {
  busy.value = true
  try {
    await task()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast.error(message || t('modules.api.mockNeedDesktop'))
  } finally {
    busy.value = false
  }
}

function start(): void {
  const item = current()
  if (!item) return
  void run(async () => {
    await api.startMock(item.id)
    hits.value = await api.mockHits(item.id)
  })
}

function stop(): void {
  const item = current()
  if (!item) return
  void run(async () => {
    await api.stopMock(item.id)
    hits.value = []
  })
}

function applyRoutes(): void {
  const item = current()
  if (!item || !listening.value) return
  void run(async () => {
    await api.pushMockRoutes(item.id)
  })
}

function refreshHits(): void {
  const item = current()
  if (!item || !listening.value) return
  void run(async () => {
    hits.value = await api.mockHits(item.id)
  })
}

function addRoute(): void {
  const item = current()
  if (!item) return
  item.routes.push(blankRoute())
  api.touchMock()
}

function removeRoute(route: ApiMockRoute): void {
  const item = current()
  if (!item) return
  item.routes = item.routes.filter((row) => row.id !== route.id)
  api.touchMock()
  applyRoutes()
}

function fromRequest(value: RsSelectModelValue): void {
  const requestId = typeof value === 'string' ? value : ''
  if (!requestId) return
  const item = current()
  const req = api.requestById(requestId)
  if (!item || !req) return
  item.routes.push({
    ...blankRoute(),
    name: req.name,
    method: req.method,
    path: pathOfUrl(req.url),
    body: req.bodyMode === 'none' ? '' : req.body,
    sourceRequestId: req.id,
  })
  api.touchMock()
  applyRoutes()
}

function setPort(value: string | number): void {
  const item = current()
  if (!item) return
  const port = Number(value)
  item.port = Number.isFinite(port) ? port : 0
}

function setStatus(route: ApiMockRoute, value: string | number): void {
  const status = Number(value)
  route.status = Number.isFinite(status) ? status : 200
}

function blankRoute(): ApiMockRoute {
  return {
    id: createId('route'),
    name: '',
    method: 'GET',
    path: '/',
    match: 'exact',
    status: 200,
    headers: [],
    body: '',
    delayMs: 0,
  }
}
</script>

<template>
  <div class="nm-api-mock">
    <header class="nm-api-mock__bar">
      <RsSelect
        v-if="serverOptions.length"
        v-model="serverId"
        :options="serverOptions"
        size="sm"
        radius="sm"
        :searchable="false"
        :clearable="false"
      />
      <RsInput v-if="server" v-model="server.host" size="sm" :placeholder="t('modules.api.mockHost')" @change="api.touchMock()" />
      <RsInput v-if="server" :model-value="String(server.port)" size="sm" :placeholder="t('modules.api.mockPort')" @update:model-value="setPort" @change="api.touchMock()" />
      <RsButton v-if="!listening" size="sm" variant="text" tone="success" icon="play" :disabled="busy" @click="start">
        {{ t('modules.api.mockStart') }}
      </RsButton>
      <RsButton v-else size="sm" variant="text" tone="danger" icon="square" :disabled="busy" @click="stop">
        {{ t('modules.api.mockStop') }}
      </RsButton>
      <span v-if="listening" class="nm-api-mock__listen">{{ t('modules.api.mockListening', { addr: listening }) }}</span>
      <span v-else class="nm-api-mock__listen">{{ t('modules.api.mockIdle') }}</span>
    </header>

    <div v-if="server" class="nm-api-mock__tools">
      <RsButton size="sm" variant="ghost" icon="plus" @click="addRoute">{{ t('modules.api.mockAdd') }}</RsButton>
      <RsSelect
        model-value=""
        :options="requestOptions"
        size="sm"
        radius="sm"
        :searchable="false"
        :clearable="false"
        @update:model-value="fromRequest"
      />
      <RsButton v-if="listening" size="sm" variant="ghost" @click="applyRoutes">{{ t('modules.api.mockApply') }}</RsButton>
      <RsButton v-if="listening" size="sm" variant="ghost" @click="refreshHits">{{ t('modules.api.mockRefresh') }}</RsButton>
    </div>

    <div class="nm-api-mock__body">
      <section class="nm-api-mock__routes">
        <article v-for="route in server?.routes ?? []" :key="route.id" class="nm-api-mock__route">
          <div class="nm-api-mock__route-bar">
            <RsSelect v-model="route.method" :options="methodOptions" size="sm" radius="sm" :searchable="false" :clearable="false" />
            <RsInput v-model="route.path" size="sm" :placeholder="t('modules.api.mockPath')" />
            <RsSelect v-model="route.match" :options="matchOptions" size="sm" radius="sm" :searchable="false" :clearable="false" />
            <RsInput :model-value="String(route.status)" size="sm" :placeholder="t('modules.api.mockStatus')" @update:model-value="setStatus(route, $event)" />
            <RsButton size="sm" variant="ghost" icon-only icon="trash-2" @click="removeRoute(route)" />
          </div>
          <textarea v-model="route.body" class="nm-api-mock__text" rows="4" :placeholder="t('modules.api.mockBody')" @change="applyRoutes" />
          <textarea v-model="route.script" class="nm-api-mock__text" rows="3" :placeholder="t('modules.api.mockScript')" @change="applyRoutes" />
        </article>
      </section>
      <aside v-if="listening" class="nm-api-mock__hits">
        <h3>{{ t('modules.api.mockHits') }}</h3>
        <p v-for="(hit, index) in hits" :key="`${hit.at}-${index}`">
          {{ hit.method }} {{ hit.path }} · {{ hit.matched ? hit.status : t('modules.api.mockMiss') }}
        </p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.nm-api-mock {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-api-mock__bar,
.nm-api-mock__tools {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-height: var(--nm-tabbar-h);
  padding: 0 var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-mock__bar > :deep(.rs-input),
.nm-api-mock__tools > :deep(.rs-select) {
  width: 10rem;
}

.nm-api-mock__listen {
  margin-inline-start: auto;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.nm-api-mock__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.nm-api-mock__routes {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: var(--rs-space-sm);
}

.nm-api-mock__route {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
  margin-bottom: var(--rs-space-sm);
  padding: var(--rs-space-xs);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
}

.nm-api-mock__route-bar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
}

.nm-api-mock__route-bar > :deep(.rs-select) {
  width: 6.5rem;
}

.nm-api-mock__route-bar > :deep(.rs-input) {
  flex: 1;
}

.nm-api-mock__text {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  color: var(--rs-text);
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-sm);
  padding: var(--rs-space-xs);
}

.nm-api-mock__hits {
  width: 16rem;
  overflow: auto;
  border-inline-start: 1px solid var(--rs-border-subtle);
  padding: var(--rs-space-sm);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.nm-api-mock__hits h3 {
  margin: 0 0 var(--rs-space-xs);
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-api-mock__hits p {
  margin: 0 0 var(--rs-space-xs);
}
</style>
