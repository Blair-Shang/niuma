<script setup lang="ts">
import { RsButton, RsEmpty, RsInput, RsVirtualList, useRsToast } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MongoMonitorEvent } from '@/api/types/mongodb'
import { useMongoChangeStream } from '@/modules/mongodb/composables/useMongoChangeStream'
import { formatMongoJson } from '@/modules/mongodb/utils/format'

const props = defineProps<{
  sessionId: string | null
  initialDatabase?: string
  initialCollection?: string
  active?: boolean
}>()

interface LiveEvent {
  id: number
  operationType: string
  summary: string
  raw: string
}

const MAX_EVENTS = 2000
const LINE_ITEM_SIZE = 72

const { t } = useI18n()
const toast = useRsToast()
const stream = useMongoChangeStream()

const database = ref(props.initialDatabase ?? '')
const collection = ref(props.initialCollection ?? '')
const events = ref<LiveEvent[]>([])
const paused = ref(false)
let seq = 0

const running = computed(() => stream.state.value === 'starting' || stream.state.value === 'ready')
const tailScrollIndex = ref<number | null>(null)

function onEvent(event: MongoMonitorEvent): void {
  if (paused.value) {
    return
  }
  const doc = event.document
  const operationType = typeof doc.operationType === 'string' ? doc.operationType : 'change'
  seq += 1
  events.value.push({
    id: seq,
    operationType,
    summary: summarizeEvent(doc),
    raw: formatMongoJson(doc),
  })
  if (events.value.length > MAX_EVENTS) {
    events.value.splice(0, events.value.length - MAX_EVENTS)
  }
}

function summarizeEvent(doc: Record<string, unknown>): string {
  const ns = doc.ns as { db?: string; coll?: string } | undefined
  const db = ns?.db ?? ''
  const coll = ns?.coll ?? ''
  const op = typeof doc.operationType === 'string' ? doc.operationType : 'change'
  return `${op} · ${db}.${coll}`
}

async function toggle(): Promise<void> {
  if (running.value) {
    await stream.stop()
    return
  }
  if (!props.sessionId) {
    toast.error(t('modules.mongodb.console.noSession'))
    return
  }
  if (!database.value.trim() || !collection.value.trim()) {
    toast.error(t('modules.mongodb.live.needTarget'))
    return
  }
  try {
    await stream.start(
      {
        sessionId: props.sessionId,
        database: database.value.trim(),
        collection: collection.value.trim(),
      },
      onEvent,
    )
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.live.startError'))
  }
}

function clearEvents(): void {
  events.value = []
  tailScrollIndex.value = null
}

watch(
  () => events.value.length,
  (len, prev) => {
    if (len > (prev ?? 0) && !paused.value && running.value) {
      tailScrollIndex.value = len - 1
    }
  },
)

watch(
  () => props.active,
  async (active) => {
    if (!active && running.value) {
      await stream.stop()
    }
  },
)
</script>

<template>
  <div class="nm-mongo-live">
    <header class="nm-mongo-live__header">
      <div class="nm-mongo-live__filters">
        <RsInput v-model="database" :placeholder="t('modules.mongodb.live.database')" />
        <RsInput v-model="collection" :placeholder="t('modules.mongodb.live.collection')" />
      </div>
      <div class="nm-mongo-live__actions">
        <RsButton size="sm" :variant="running ? 'secondary' : 'primary'" @click="toggle">
          {{ running ? t('modules.mongodb.live.stop') : t('modules.mongodb.live.start') }}
        </RsButton>
        <RsButton size="sm" variant="ghost" :disabled="events.length === 0" @click="clearEvents">
          {{ t('modules.mongodb.live.clear') }}
        </RsButton>
        <label class="nm-mongo-live__pause">
          <input v-model="paused" type="checkbox" />
          {{ t('modules.mongodb.live.pause') }}
        </label>
      </div>
    </header>

    <p class="nm-mongo-live__hint">{{ t('modules.mongodb.live.hint') }}</p>

    <RsEmpty v-if="!running && events.length === 0" class="nm-mongo-live__empty" :description="t('modules.mongodb.live.empty')" />

    <RsVirtualList
      v-else
      class="nm-mongo-live__list"
      :items="events"
      :item-size="LINE_ITEM_SIZE"
      key-field="id"
      :active-index="tailScrollIndex"
    >
      <template #default="{ item }">
        <article class="nm-mongo-live__item">
          <div class="nm-mongo-live__item-head">
            <span class="nm-mongo-live__op">{{ item.operationType }}</span>
            <span class="nm-mongo-live__summary">{{ item.summary }}</span>
          </div>
          <pre class="nm-mongo-live__raw">{{ item.raw }}</pre>
        </article>
      </template>
    </RsVirtualList>
  </div>
</template>

<style scoped>
.nm-mongo-live {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-mongo-live__header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-sm);
  align-items: center;
  justify-content: space-between;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-mongo-live__filters {
  display: flex;
  gap: var(--rs-space-sm);
  flex: 1;
  min-width: 240px;
}

.nm-mongo-live__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-wrap: wrap;
}

.nm-mongo-live__pause {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-mongo-live__hint {
  margin: 0;
  padding: var(--rs-space-xs) var(--rs-space-md);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-mongo-live__empty {
  flex: 1;
}

.nm-mongo-live__list {
  flex: 1;
  min-height: 0;
}

.nm-mongo-live__item {
  padding: var(--rs-space-xs) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-mongo-live__item-head {
  display: flex;
  gap: var(--rs-space-sm);
  align-items: baseline;
  margin-bottom: 2px;
}

.nm-mongo-live__op {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-accent);
  text-transform: uppercase;
}

.nm-mongo-live__summary {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
}

.nm-mongo-live__raw {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  font-family: var(--rs-font-mono);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--rs-text);
}
</style>
