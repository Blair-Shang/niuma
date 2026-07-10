<script setup lang="ts">
import {
  RsButton,
  RsCard,
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
import type { RedisMonitorLineEvent } from '@/api/types/redis'
import { useRedisMonitorStream } from '@/modules/redis/composables/useRedisMonitorStream'

const props = defineProps<{
  sessionId: string | null
  active: boolean
}>()

interface LiveLine {
  id: number
  timestamp: number
  db: number
  client: string
  command: string
  truncated: boolean
}

/**
 * 内存侧缓冲上限：虚拟列表只渲染可视区 DOM，但数组仍会随 MONITOR 推送增长，
 * 超出后丢弃最旧行，避免长时间开启导致内存持续上涨。
 * 列表为倒序（最新行在 index 0），便于始终看到最新命令而无需滚到底部。
 */
const MAX_BUFFER_LINES = 5000
const LINE_ITEM_SIZE = 28

const { t } = useI18n()
const toast = useRsToast()
const { state, message, start, stop } = useRedisMonitorStream()

const lines = ref<LiveLine[]>([])
const filterText = ref('')
const paused = ref(false)
let lineSeq = 0

const running = computed(() => state.value === 'starting' || state.value === 'ready')

const filteredLines = computed(() => {
  const keyword = filterText.value.trim().toLowerCase()
  if (!keyword) {
    return lines.value
  }
  return lines.value.filter(
    (line) => line.command.toLowerCase().includes(keyword) || line.client.toLowerCase().includes(keyword),
  )
})

const lineCountLabel = computed(() => t('modules.redis.live.lineCount', { count: lines.value.length }))

/** 跟随最新一行；用户向下滚动查看历史时暂停 */
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
      if (running.value && filteredLines.value.length > 0) {
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

function onLine(event: RedisMonitorLineEvent): void {
  if (paused.value) {
    return
  }
  const data = event.data
  lineSeq += 1
  lines.value.unshift({
    id: lineSeq,
    timestamp: data.timestamp,
    db: data.db,
    client: data.client,
    command:
      data.command.map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ') + (data.truncated ? ' …' : ''),
    truncated: data.truncated,
  })
  if (lines.value.length > MAX_BUFFER_LINES) {
    lines.value.length = MAX_BUFFER_LINES
  }
}

async function toggle(): Promise<void> {
  if (running.value) {
    await stop()
    return
  }
  if (!props.sessionId) {
    toast.error(t('modules.redis.console.noSession'))
    return
  }
  try {
    await start(props.sessionId, onLine)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.redis.live.startError'))
  }
}

function clearLines(): void {
  lines.value = []
  tailScrollIndex.value = null
  followLatest.value = true
}

function formatTimestamp(ts: number): string {
  const millis = Math.floor((ts % 1) * 1000)
  return `${new Date(ts * 1000).toLocaleTimeString(undefined, { hour12: false })}.${String(millis).padStart(3, '0')}`
}

watch(
  () => filteredLines.value.length,
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
  () => [virtualListRef.value, filteredLines.value.length > 0] as const,
  () => {
    void nextTick(() => attachScrollListener())
  },
)

onUnmounted(() => detachScrollListener())

watch(
  () => props.active,
  (active) => {
    if (!active && running.value) {
      void stop()
    }
  },
)
</script>

<template>
  <div class="nm-redis-live">
    <RsTooltipProvider>
      <section class="nm-redis-live__toolbar">
        <div class="nm-redis-live__actions">
          <RsTooltip :content="running ? t('modules.redis.live.tooltips.stop') : t('modules.redis.live.tooltips.start')" side="bottom">
            <RsButton size="sm" :variant="running ? 'danger' : 'primary'" @click="toggle">
              <RsIcon :name="running ? 'square' : 'play'" :size="14" />
              {{ running ? t('modules.redis.live.stop') : t('modules.redis.live.start') }}
            </RsButton>
          </RsTooltip>
          <RsTooltip :content="paused ? t('modules.redis.live.tooltips.resume') : t('modules.redis.live.tooltips.pause')" side="bottom">
            <RsButton size="sm" variant="ghost" :disabled="!running" @click="paused = !paused">
              <RsIcon :name="paused ? 'play' : 'pause'" :size="14" />
              {{ paused ? t('modules.redis.live.resume') : t('modules.redis.live.pause') }}
            </RsButton>
          </RsTooltip>
          <RsInput
            v-model="filterText"
            class="nm-redis-live__filter"
            size="sm"
            autocomplete="off"
            :placeholder="t('modules.redis.live.filterPlaceholder')"
          >
            <template #prefix>
              <RsIcon name="search" :size="14" />
            </template>
          </RsInput>
          <RsTooltip :content="t('modules.redis.live.tooltips.clear')" side="bottom">
            <RsButton size="sm" variant="ghost" :disabled="lines.length === 0" @click="clearLines">
              <RsIcon name="eraser" :size="14" />
            </RsButton>
          </RsTooltip>
        </div>
        <div class="nm-redis-live__meta">
          <span v-if="lines.length > 0" class="nm-redis-live__line-badge">{{ lineCountLabel }}</span>
          <span class="nm-redis-live__status" :class="`nm-redis-live__status--${state}`">
            <span v-if="state === 'ready'" class="nm-redis-live__live-dot" aria-hidden="true" />
            {{ t(`modules.redis.live.state.${state}`) }}
          </span>
        </div>
      </section>

      <p v-if="message && state === 'lost'" class="nm-redis-live__error" role="alert">{{ message }}</p>

      <div class="nm-redis-live__card-wrap">
        <RsCard variant="plain" :padding="false" class="nm-redis-live__card">
          <template #header>
            <div class="nm-redis-live__card-head">
              <span class="nm-redis-live__card-icon" aria-hidden="true">
                <RsIcon name="radio" :size="14" />
              </span>
              <h3 class="nm-redis-live__card-title">{{ t('modules.redis.live.title') }}</h3>
              <RsTooltip :content="t('modules.redis.live.perfWarning')" side="bottom" align="end">
                <button type="button" class="nm-redis-live__info-btn" :aria-label="t('modules.redis.live.perfWarning')">
                  <RsIcon name="triangle-alert" :size="14" />
                </button>
              </RsTooltip>
            </div>
          </template>

          <div class="nm-redis-live__output">
            <RsEmpty v-if="filteredLines.length === 0" class="nm-redis-live__empty" :description="t('modules.redis.live.empty')" />
            <RsVirtualList
              v-else
              ref="virtualListRef"
              class="nm-redis-live__virtual"
              :items="filteredLines"
              :height="0"
              :item-size="LINE_ITEM_SIZE"
              :overscan="10"
              :active-index="tailScrollIndex"
            >
              <template #default="{ item, index }">
                <div
                  class="nm-redis-live__line"
                  :class="{ 'nm-redis-live__line--alt': index % 2 === 1 }"
                >
                  <span class="nm-redis-live__ts">{{ formatTimestamp(item.timestamp) }}</span>
                  <span class="nm-redis-live__db">db{{ item.db }}</span>
                  <span class="nm-redis-live__client" :title="item.client">{{ item.client }}</span>
                  <RsTooltip v-if="item.truncated" :content="item.command" side="top" align="start">
                    <code class="nm-redis-live__cmd nm-redis-live__cmd--truncated">{{ item.command }}</code>
                  </RsTooltip>
                  <code v-else class="nm-redis-live__cmd" :title="item.command">{{ item.command }}</code>
                </div>
              </template>
            </RsVirtualList>
          </div>
        </RsCard>
      </div>
    </RsTooltipProvider>
  </div>
</template>

<style scoped>
.nm-redis-live {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm) var(--rs-space-md);
}

.nm-redis-live__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md);
  flex-wrap: wrap;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-radius: var(--rs-radius-md);
  border: 1px solid color-mix(in srgb, var(--rs-success) 28%, var(--rs-border-subtle));
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--rs-success) 12%, var(--rs-surface-elevated)),
    color-mix(in srgb, var(--rs-primary) 8%, var(--rs-surface-elevated))
  );
}

.nm-redis-live__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-wrap: wrap;
}

.nm-redis-live__filter {
  width: 14rem;
}

.nm-redis-live__meta {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  margin-left: auto;
}

.nm-redis-live__line-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--rs-success) 16%, transparent);
  color: var(--rs-success);
}

.nm-redis-live__status {
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

.nm-redis-live__status--ready {
  background: color-mix(in srgb, var(--rs-success) 16%, transparent);
  color: var(--rs-success);
}

.nm-redis-live__status--starting {
  background: color-mix(in srgb, var(--rs-warning) 16%, transparent);
  color: var(--rs-warning);
}

.nm-redis-live__status--lost {
  background: color-mix(in srgb, var(--rs-danger) 16%, transparent);
  color: var(--rs-danger);
}

.nm-redis-live__live-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: var(--rs-radius-full);
  background: currentColor;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--rs-success) 28%, transparent);
  animation: nm-redis-live-pulse 1.8s ease-in-out infinite;
}

@keyframes nm-redis-live-pulse {
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

.nm-redis-live__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-redis-live__card-wrap {
  --nm-live-accent: var(--rs-success);
  --nm-live-accent-bg: color-mix(in srgb, var(--nm-live-accent) 14%, transparent);
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: var(--rs-radius-lg);
  overflow: hidden;
  background: color-mix(in srgb, var(--nm-live-accent) 6%, var(--rs-surface-subtle));
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--nm-live-accent) 22%, var(--rs-border-subtle)),
    0 4px 14px color-mix(in srgb, var(--nm-live-accent) 10%, transparent);
}

.nm-redis-live__card-wrap::before {
  content: '';
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(
    90deg,
    var(--nm-live-accent),
    color-mix(in srgb, var(--rs-primary) 70%, var(--nm-live-accent))
  );
  pointer-events: none;
}

.nm-redis-live__card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-redis-live__card :deep(.rs-card__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nm-redis-live__card-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-width: 0;
}

.nm-redis-live__card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  height: 1.625rem;
  border-radius: var(--rs-radius-full);
  background: var(--nm-live-accent-bg);
  color: var(--nm-live-accent);
  flex-shrink: 0;
}

.nm-redis-live__card-title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--nm-live-accent);
}

.nm-redis-live__info-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  height: 1.625rem;
  margin: 0 0 0 auto;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--rs-warning) 35%, transparent);
  border-radius: var(--rs-radius-full);
  background: color-mix(in srgb, var(--rs-warning) 12%, transparent);
  color: var(--rs-warning);
  cursor: help;
  flex-shrink: 0;
}

.nm-redis-live__info-btn:hover {
  background: color-mix(in srgb, var(--rs-warning) 20%, transparent);
}

.nm-redis-live__output {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-redis-live__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 12rem;
}

.nm-redis-live__virtual {
  border: none;
  border-radius: 0;
  background: transparent;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--rs-font-size-xs);
}

.nm-redis-live__line {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  height: 100%;
  padding: 0 var(--rs-space-md);
  box-sizing: border-box;
}

.nm-redis-live__line--alt {
  background: color-mix(in srgb, var(--rs-primary) 5%, transparent);
}

.nm-redis-live__ts {
  color: var(--rs-muted);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.nm-redis-live__db {
  flex-shrink: 0;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.68rem;
  background: color-mix(in srgb, var(--rs-primary) 18%, transparent);
  color: var(--rs-primary);
}

.nm-redis-live__client {
  color: var(--rs-muted);
  flex-shrink: 0;
  width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-redis-live__cmd {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rs-text);
  background: transparent;
  font-family: inherit;
  font-size: inherit;
}

.nm-redis-live__cmd--truncated {
  color: var(--rs-warning);
}
</style>
