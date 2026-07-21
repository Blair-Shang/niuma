<script setup lang="ts">
import {
  RsButton,
  RsEmpty,
  RsIcon,
  RsInput,
  RsTooltip,
  RsTooltipProvider,
  RsVirtualList,
  useRsToast,
} from '@niuma/ui'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MongoMonitorEvent } from '@/api/types/mongodb'
import { useMongoChangeStream } from '@/modules/mongodb/composables/useMongoChangeStream'
import { formatMongoJson } from '@/modules/mongodb/utils/format'
import {
  formatChangeStreamStartError,
  isReplicaSetRequiredError,
} from '@/modules/mongodb/utils/change-stream-error'

const props = defineProps<{
  sessionId: string | null
  initialDatabase?: string
  initialCollection?: string
  scopeLocked?: boolean
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
const { state, message, start, stop } = useMongoChangeStream()

const database = ref(props.initialDatabase ?? '')
const collection = ref(props.initialCollection ?? '')
const events = ref<LiveEvent[]>([])
const filterText = ref('')
const paused = ref(false)
const startError = ref('')
let seq = 0

const running = computed(() => state.value === 'starting' || state.value === 'ready')
const hasTarget = computed(
  () => !!props.sessionId && database.value.trim().length > 0 && collection.value.trim().length > 0,
)
const targetLabel = computed(() => `${database.value.trim()}.${collection.value.trim()}`)

const filteredEvents = computed(() => {
  const keyword = filterText.value.trim().toLowerCase()
  if (!keyword) {
    return events.value
  }
  return events.value.filter(
    (event) =>
      event.operationType.toLowerCase().includes(keyword)
      || event.summary.toLowerCase().includes(keyword)
      || event.raw.toLowerCase().includes(keyword),
  )
})

const eventCountLabel = computed(() => t('modules.mongodb.live.eventCount', { count: events.value.length }))

/** 倒序列表：最新事件在 index 0 */
const followLatest = ref(true)
const tailScrollIndex = ref<number | null>(null)
const virtualListRef = ref<{ $el: HTMLElement } | null>(null)

let scrollEl: HTMLElement | null = null

function detachScrollListener(): void {
  scrollEl?.removeEventListener('scroll', onListScroll)
  scrollEl = null
}

function attachScrollListener(): void {
  detachScrollListener()
  const el = virtualListRef.value?.$el
  if (el instanceof HTMLElement) {
    scrollEl = el
    scrollEl.addEventListener('scroll', onListScroll, { passive: true })
  }
}

function onListScroll(): void {
  if (!scrollEl) {
    return
  }
  const nearTop = scrollEl.scrollTop <= LINE_ITEM_SIZE / 2
  if (nearTop) {
    if (!followLatest.value) {
      followLatest.value = true
      if (running.value && filteredEvents.value.length > 0) {
        tailScrollIndex.value = 0
      }
    }
    return
  }
  if (followLatest.value) {
    followLatest.value = false
    tailScrollIndex.value = null
  }
}

function onEvent(event: MongoMonitorEvent): void {
  if (paused.value) {
    return
  }
  const doc = event.document
  const operationType = typeof doc.operationType === 'string' ? doc.operationType : 'change'
  seq += 1
  events.value.unshift({
    id: seq,
    operationType,
    summary: summarizeEvent(doc),
    raw: formatMongoJson(doc),
  })
  if (events.value.length > MAX_EVENTS) {
    events.value.length = MAX_EVENTS
  }
}

function summarizeEvent(doc: Record<string, unknown>): string {
  const ns = doc.ns as { db?: string; coll?: string } | undefined
  const db = ns?.db ?? ''
  const coll = ns?.coll ?? ''
  const op = typeof doc.operationType === 'string' ? doc.operationType : 'change'
  return `${op} · ${db}.${coll}`
}

function resolveStartError(err: unknown): string {
  const raw = err instanceof Error ? err.message : ''
  const mapped = formatChangeStreamStartError(raw, t('modules.mongodb.live.startError'))
  if (isReplicaSetRequiredError(mapped)) {
    return t('modules.mongodb.live.replicaSetRequired')
  }
  return mapped
}

async function toggle(): Promise<void> {
  if (running.value) {
    await stop()
    startError.value = ''
    return
  }
  if (!props.sessionId) {
    toast.error(t('modules.mongodb.console.noSession'))
    return
  }
  if (!hasTarget.value) {
    toast.error(t('modules.mongodb.live.needTarget'))
    return
  }
  startError.value = ''
  try {
    await start(
      {
        sessionId: props.sessionId,
        database: database.value.trim(),
        collection: collection.value.trim(),
      },
      onEvent,
    )
  } catch (e) {
    const text = resolveStartError(e)
    startError.value = text
    toast.error(text)
  }
}

function clearEvents(): void {
  events.value = []
  tailScrollIndex.value = null
  followLatest.value = true
}

function resumeFollowLatest(): void {
  followLatest.value = true
  tailScrollIndex.value = 0
}

watch(
  () => filteredEvents.value.length,
  (len, prevLen) => {
    const added = len - (prevLen ?? 0)
    if (added <= 0 || paused.value || !running.value) {
      return
    }
    if (followLatest.value) {
      tailScrollIndex.value = 0
      return
    }
    if (scrollEl) {
      scrollEl.scrollTop += added * LINE_ITEM_SIZE
    }
  },
)

watch(
  () => [virtualListRef.value, filteredEvents.value.length > 0] as const,
  () => {
    void nextTick(() => attachScrollListener())
  },
)

watch(
  () => [props.initialDatabase, props.initialCollection] as const,
  ([db, coll]) => {
    if (db) database.value = db
    if (coll) collection.value = coll
  },
  { immediate: true },
)

watch(
  () => [database.value, collection.value] as const,
  async () => {
    if (running.value) {
      await stop()
    }
  },
)

watch(
  () => props.active,
  async (active) => {
    if (!active && running.value) {
      await stop()
    }
  },
)

onUnmounted(() => detachScrollListener())
</script>

<template>
  <div class="nm-mongo-live">
    <RsTooltipProvider>
      <header class="nm-mongo-live__header">
        <div class="nm-mongo-live__scope">
          <div v-if="scopeLocked" class="nm-mongo-live__target" :title="targetLabel">
            <RsIcon name="database" :size="13" class="nm-mongo-live__target-icon" />
            <span class="nm-mongo-live__target-text">{{ targetLabel }}</span>
          </div>
          <template v-else>
            <RsInput
              v-model="database"
              class="nm-mongo-live__scope-input"
              size="sm"
              :disabled="running"
              :placeholder="t('modules.mongodb.live.database')"
            />
            <span class="nm-mongo-live__scope-dot">.</span>
            <RsInput
              v-model="collection"
              class="nm-mongo-live__scope-input nm-mongo-live__scope-input--coll"
              size="sm"
              :disabled="running"
              :placeholder="t('modules.mongodb.live.collection')"
            />
          </template>
        </div>

        <div class="nm-mongo-live__controls">
          <RsTooltip
            :content="running ? t('modules.mongodb.live.tooltips.stop') : t('modules.mongodb.live.tooltips.start')"
            side="bottom"
          >
            <RsButton
              size="sm"
              :variant="running ? 'danger' : 'primary'"
              :aria-label="running ? t('modules.mongodb.live.stop') : t('modules.mongodb.live.start')"
              @click="toggle"
            >
              <RsIcon :name="running ? 'square' : 'play'" :size="14" />
            </RsButton>
          </RsTooltip>
          <RsTooltip
            :content="paused ? t('modules.mongodb.live.tooltips.resume') : t('modules.mongodb.live.tooltips.pause')"
            side="bottom"
          >
            <RsButton
              size="sm"
              variant="ghost"
              :disabled="!running"
              :aria-label="paused ? t('modules.mongodb.live.resume') : t('modules.mongodb.live.pause')"
              @click="paused = !paused"
            >
              <RsIcon :name="paused ? 'play' : 'pause'" :size="14" />
            </RsButton>
          </RsTooltip>
          <RsTooltip :content="t('modules.mongodb.live.tooltips.clear')" side="bottom">
            <RsButton
              size="sm"
              variant="ghost"
              :disabled="events.length === 0"
              :aria-label="t('modules.mongodb.live.clear')"
              @click="clearEvents"
            >
              <RsIcon name="eraser" :size="14" />
            </RsButton>
          </RsTooltip>
        </div>

        <RsInput
          v-model="filterText"
          class="nm-mongo-live__filter"
          size="sm"
          autocomplete="off"
          :placeholder="t('modules.mongodb.live.filterPlaceholder')"
        >
          <template #prefix>
            <RsIcon name="search" :size="14" />
          </template>
        </RsInput>

        <div class="nm-mongo-live__meta">
          <span v-if="events.length > 0" class="nm-mongo-live__count">{{ eventCountLabel }}</span>
          <span class="nm-mongo-live__status" :class="`nm-mongo-live__status--${state}`">
            <span v-if="state === 'ready'" class="nm-mongo-live__live-dot" aria-hidden="true" />
            {{ t(`modules.mongodb.live.state.${state}`) }}
          </span>
        </div>
      </header>

      <p class="nm-mongo-live__hint">{{ t('modules.mongodb.live.hint') }}</p>
      <p v-if="startError" class="nm-mongo-live__error" role="alert">{{ startError }}</p>
      <p v-else-if="message && state === 'lost'" class="nm-mongo-live__error" role="alert">{{ message }}</p>

      <div class="nm-mongo-live__body">
        <RsEmpty
          v-if="filteredEvents.length === 0"
          fill
          class="nm-mongo-live__empty"
          :description="t('modules.mongodb.live.empty')"
        />
        <div v-else class="nm-mongo-live__list-wrap">
          <RsVirtualList
            ref="virtualListRef"
            class="nm-mongo-live__list"
            :items="filteredEvents"
            :height="0"
            :item-size="LINE_ITEM_SIZE"
            :overscan="8"
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
          <RsButton
            v-if="!followLatest"
            class="nm-mongo-live__follow-btn"
            size="sm"
            variant="secondary"
            @click="resumeFollowLatest"
          >
            <RsIcon name="arrow-up" :size="14" />
            {{ t('modules.mongodb.live.followLatest') }}
          </RsButton>
        </div>
      </div>
    </RsTooltipProvider>
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
  flex-wrap: nowrap;
  gap: var(--rs-space-sm);
  align-items: center;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  min-width: 0;
}

.nm-mongo-live__scope {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex: 0 1 auto;
  min-width: 0;
  max-width: 38%;
}

.nm-mongo-live__target {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-width: 0;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}

.nm-mongo-live__target-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mongo-live__target-icon {
  flex-shrink: 0;
  color: var(--rs-muted);
}

.nm-mongo-live__scope-input {
  width: 6.5rem;
  min-width: 0;
  flex-shrink: 1;
}

.nm-mongo-live__scope-input--coll {
  width: 9rem;
}

.nm-mongo-live__scope-dot {
  flex-shrink: 0;
  color: var(--rs-muted);
  font-family: var(--rs-font-mono);
}

.nm-mongo-live__controls {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.nm-mongo-live__filter {
  flex: 1 1 8rem;
  min-width: 6rem;
  max-width: 14rem;
}

.nm-mongo-live__meta {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
  margin-left: auto;
}

.nm-mongo-live__count {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--rs-primary) 14%, transparent);
  color: var(--rs-primary);
}

.nm-mongo-live__status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--rs-surface-subtle);
  color: var(--rs-muted);
  white-space: nowrap;
}

.nm-mongo-live__status--ready {
  background: color-mix(in srgb, var(--rs-success) 16%, transparent);
  color: var(--rs-success);
}

.nm-mongo-live__status--starting {
  background: color-mix(in srgb, var(--rs-warning) 16%, transparent);
  color: var(--rs-warning);
}

.nm-mongo-live__status--lost {
  background: color-mix(in srgb, var(--rs-danger) 16%, transparent);
  color: var(--rs-danger);
}

.nm-mongo-live__live-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: var(--rs-radius-full);
  background: currentColor;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--rs-success) 28%, transparent);
  animation: nm-mongo-live-pulse 1.8s ease-in-out infinite;
}

@keyframes nm-mongo-live-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.55;
    transform: scale(0.88);
  }
}

.nm-mongo-live__hint {
  margin: 0;
  padding: var(--rs-space-xs) var(--rs-space-md);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-mongo-live__error {
  margin: 0;
  padding: 0 var(--rs-space-md) var(--rs-space-xs);
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-mongo-live__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-mongo-live__empty {
  flex: 1;
}

.nm-mongo-live__list-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-mongo-live__list {
  border: none;
  border-radius: 0;
  background: transparent;
}

.nm-mongo-live__follow-btn {
  position: absolute;
  right: var(--rs-space-md);
  bottom: var(--rs-space-md);
  z-index: 1;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--rs-shadow) 28%, transparent);
}

.nm-mongo-live__item {
  padding: var(--rs-space-xs) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  box-sizing: border-box;
  height: 100%;
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
