<script setup lang="ts">
/**
 * AI 助手 ECharts 块：尺寸就绪后再挂载，避免 clientWidth/Height=0 告警。
 * 放大预览在应用内 Lightbox，避免 CEF target=_blank 弹出黑屏窗。
 */
import { use } from 'echarts/core'
import type { EChartsOption } from 'echarts'
import {
  BarChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
} from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { RsIcon } from '@niuma/ui'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseAiChartOption } from './echarts-lite'
import AiMediaLightbox from './AiMediaLightbox.vue'

use([
  BarChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
])

const VChart = defineAsyncComponent(() => import('vue-echarts'))

const props = defineProps<{
  source: string
  active: boolean
}>()

const { t } = useI18n()
const option = ref<EChartsOption | null>(null)
const parseError = ref<string | null>(null)
const shellEl = ref<HTMLElement | null>(null)
/** 容器已有非 0 尺寸后再挂 VChart，避免 ECharts init 告警。 */
const sizeReady = ref(false)
const previewOpen = ref(false)

let resizeObserver: ResizeObserver | null = null

function syncSizeReady(): void {
  const el = shellEl.value
  if (!el) {
    sizeReady.value = false
    return
  }
  sizeReady.value = el.clientWidth > 0 && el.clientHeight > 0
}

function bindResizeObserver(): void {
  unbindResizeObserver()
  const el = shellEl.value
  if (!el || typeof ResizeObserver === 'undefined') {
    syncSizeReady()
    return
  }
  resizeObserver = new ResizeObserver(() => {
    syncSizeReady()
  })
  resizeObserver.observe(el)
  syncSizeReady()
}

function unbindResizeObserver(): void {
  resizeObserver?.disconnect()
  resizeObserver = null
}

watch(
  () => [props.active, props.source] as const,
  async ([active, source]) => {
    sizeReady.value = false
    if (!active) {
      option.value = null
      parseError.value = null
      previewOpen.value = false
      return
    }
    const res = parseAiChartOption(source)
    option.value = res.option
    parseError.value = res.error
    await nextTick()
    bindResizeObserver()
    // 再等一帧，确保 flex/分栏布局完成
    requestAnimationFrame(() => {
      syncSizeReady()
    })
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  unbindResizeObserver()
})

const showChart = computed(
  () => props.active && option.value != null && !parseError.value && sizeReady.value,
)

function openPreview(): void {
  if (!showChart.value || !option.value) {
    return
  }
  previewOpen.value = true
}
</script>

<template>
  <div ref="shellEl" class="nm-ai-chart">
    <div v-if="!active" class="nm-ai-chart__pending">
      {{ t('ai.chartPending') }}
    </div>
    <div v-else-if="parseError" class="nm-ai-chart__error" role="alert">
      {{ t('ai.chartInvalid') }}
      <pre class="nm-ai-chart__raw">{{ source }}</pre>
    </div>
    <template v-else>
      <!-- 占位保证父级始终有宽高，供 ResizeObserver / ECharts 读取 -->
      <div class="nm-ai-chart__frame">
        <button
          v-if="showChart"
          type="button"
          class="nm-ai-chart__expand"
          :title="t('ai.chartExpand')"
          :aria-label="t('ai.chartExpand')"
          @click="openPreview"
        >
          <RsIcon name="zoom-in" :size="13" />
        </button>
        <VChart
          v-if="showChart"
          class="nm-ai-chart__canvas"
          :option="option!"
          autoresize
        />
      </div>
    </template>

    <AiMediaLightbox v-model:open="previewOpen">
      <template #chart>
        <VChart
          v-if="previewOpen && option"
          class="nm-ai-chart-lightbox__canvas"
          :option="option"
          autoresize
        />
      </template>
    </AiMediaLightbox>
  </div>
</template>

<style scoped>
.nm-ai-chart {
  margin: 0.65em 0;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--nm-elevated-bg) 80%, transparent);
}

.nm-ai-chart__frame {
  width: 100%;
  height: 280px;
  min-height: 220px;
  position: relative;
}

.nm-ai-chart__expand {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: 8px;
  background: color-mix(in srgb, var(--nm-elevated-bg) 88%, transparent);
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-ai-chart__expand:hover {
  color: var(--rs-text);
  background: color-mix(in srgb, var(--rs-text) 8%, var(--nm-elevated-bg));
}

.nm-ai-chart__canvas {
  width: 100%;
  height: 100%;
  min-height: 220px;
}

.nm-ai-chart__pending,
.nm-ai-chart__error {
  padding: 12px 14px;
  font-size: 12px;
  color: var(--rs-muted);
}

.nm-ai-chart__error {
  color: var(--rs-danger);
}

.nm-ai-chart__raw {
  margin: 8px 0 0;
  max-height: 8rem;
  overflow: auto;
  padding: 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--rs-text) 5%, transparent);
  color: var(--rs-muted);
  font-size: 11px;
  white-space: pre-wrap;
}
</style>

<style>
/* Teleport 到 body 的预览画布（不能用 scoped） */
.nm-ai-chart-lightbox__canvas {
  width: 100%;
  height: 100%;
  min-height: 320px;
  border-radius: 12px;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--nm-elevated-bg) 92%, transparent);
}
</style>
