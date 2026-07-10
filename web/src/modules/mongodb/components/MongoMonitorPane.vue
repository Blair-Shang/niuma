<script setup lang="ts">
import { RsButton, RsLoading } from '@niuma/ui'
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { MongoMonitorStatsResult } from '@/api/types/mongodb'
import { formatMongoJson } from '@/modules/mongodb/utils/format'

const props = defineProps<{
  sessionId: string | null
  active: boolean
}>()

const { t } = useI18n()

const stats = ref<MongoMonitorStatsResult | null>(null)
const currentOpText = ref('')
const loading = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

async function refresh(): Promise<void> {
  if (!props.sessionId) {
    return
  }
  loading.value = true
  try {
    const [statsResult, opResult] = await Promise.all([
      mongodbApi.monitorStats({ sessionId: props.sessionId }),
      mongodbApi.monitorCurrentOp({ sessionId: props.sessionId, activeOnly: true }),
    ])
    stats.value = statsResult
    currentOpText.value = formatMongoJson(opResult.operations)
  } finally {
    loading.value = false
  }
}

function startPolling(): void {
  stopPolling()
  void refresh()
  timer = setInterval(() => {
    void refresh()
  }, 5000)
}

function stopPolling(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

watch(
  () => [props.active, props.sessionId] as const,
  ([active, sid]) => {
    if (active && sid) {
      startPolling()
    } else {
      stopPolling()
    }
  },
  { immediate: true },
)

onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="nm-mongo-monitor">
    <header class="nm-mongo-monitor__toolbar">
      <RsButton size="sm" variant="ghost" :loading="loading" :disabled="!sessionId" @click="refresh">
        {{ t('modules.mongodb.monitor.refresh') }}
      </RsButton>
    </header>
    <RsLoading v-if="loading && !stats" class="nm-mongo-monitor__loading" />
    <div v-else class="nm-mongo-monitor__body">
      <section v-if="stats" class="nm-mongo-monitor__panel">
        <h3>{{ t('modules.mongodb.monitor.server') }}</h3>
        <pre>{{ formatMongoJson(stats.serverStatus) }}</pre>
      </section>
      <section v-if="stats" class="nm-mongo-monitor__panel">
        <h3>{{ t('modules.mongodb.monitor.database', { name: stats.database }) }}</h3>
        <pre>{{ formatMongoJson(stats.dbStats) }}</pre>
      </section>
      <section class="nm-mongo-monitor__panel">
        <h3>{{ t('modules.mongodb.monitor.currentOp') }}</h3>
        <pre>{{ currentOpText || '[]' }}</pre>
      </section>
    </div>
  </div>
</template>

<style scoped>
.nm-mongo-monitor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-mongo-monitor__toolbar {
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-mongo-monitor__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-mongo-monitor__body {
  flex: 1;
  overflow: auto;
  padding: var(--rs-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-mongo-monitor__panel h3 {
  margin: 0 0 var(--rs-space-xs);
  font-size: var(--rs-font-size-sm);
}

.nm-mongo-monitor__panel pre {
  margin: 0;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
  white-space: pre-wrap;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  padding: var(--rs-space-sm);
}
</style>
