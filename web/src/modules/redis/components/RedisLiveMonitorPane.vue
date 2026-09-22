<script setup lang="ts">
import {
  RsCard,
  RsEmpty,
  RsIcon,
  RsTooltip,
  RsTooltipProvider,
  RsVirtualList,
  useRsToast,
} from '@niuma/ui'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RedisMonitorLineEvent } from '@/api/types/redis'
import SqlIdeToolbar from '@/modules/database/components/SqlIdeToolbar.vue'
import type { SqlIdeToolbarItem } from '@/modules/database/types/sql-ide-toolbar'
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

const toolbarItems = computed((): SqlIdeToolbarItem[] => [
  {
    key: 'toggle',
    icon: running.value ? 'square' : 'play',
    tone: running.value ? 'danger' : 'success',
    title: running.value ? t('modules.redis.live.tooltips.stop') : t('modules.redis.live.tooltips.start'),
    label: running.value ? t('modules.redis.live.stop') : t('modules.redis.live.start'),
    disabled: !props.sessionId && !running.value,
  },
  {
    key: 'pause',
    icon: paused.value ? 'play' : 'pause',
    title: paused.value ? t('modules.redis.live.tooltips.resume') : t('modules.redis.live.tooltips.pause'),
    disabled: !running.value,
  },
  {
    key: 'filter',
    kind: 'filter',
    value: filterText.value,
    placeholder: t('modules.redis.live.filterPlaceholder'),
  },
  {
    key: 'clear',
    icon: 'eraser',
    title: t('modules.redis.live.tooltips.clear'),
    disabled: lines.value.length === 0,
    align: 'trail',
  },
])

function onToolbarAction(key: string): void {
  if (key === 'toggle') void toggle()
  else if (key === 'pause') paused.value = !paused.value
  else if (key === 'clear') clearLines()
}

function onToolbarFilter(itemKey: string, value: string): void {
  if (itemKey === 'filter') filterText.value = value
}

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
    <SqlIdeToolbar
      :label="t('modules.redis.live.toolbarAria')"
      identity-icon="radio"
      :identity="t('modules.redis.live.title')"
      :identity-title="`${t(`modules.redis.live.state.${state}`)}${lines.length > 0 ? ` · ${lineCountLabel}` : ''}`"
      :items="toolbarItems"
      @action="onToolbarAction"
      @filter="onToolbarFilter"
    />
    <div class="nm-redis-live__main">
    <RsTooltipProvider>

      <p v-if="message && state === 'lost'" class="nm-redis-live__error" role="alert">{{ message }}</p>

      <div class="nm-redis-live__card-wrap">
        <RsCard variant="plain" :padding="false" radius="none" class="nm-redis-live__card">
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
  </div>
</template>

<style scoped>
.nm-redis-live {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-redis-live__main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-redis-live__error {
  margin: 0;
  padding: 0 var(--rs-space-sm);
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-redis-live__card-wrap {
  --nm-live-accent: var(--rs-success);
  --nm-live-accent-bg: color-mix(in srgb, var(--nm-live-accent) 14%, transparent);
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: none;
  border-radius: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--nm-live-accent) 6%, var(--rs-surface-subtle));
}

.nm-redis-live__card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: none;
  box-shadow: none;
  background: transparent;
  border-radius: 0;
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
