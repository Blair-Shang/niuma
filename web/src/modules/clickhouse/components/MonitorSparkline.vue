<script setup lang="ts">
import { use } from 'echarts/core'
import type { EChartsOption } from 'echarts'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { computed } from 'vue'
import VChart from 'vue-echarts'

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = withDefaults(
  defineProps<{
    values: Array<number | null | undefined>
    /** 与 values 对齐的采样时间戳（ms） */
    timestamps?: Array<number | null | undefined>
    label?: string
    formatValue?: (n: number) => string
    height?: string
    /** 折线主色，默认读取 --rs-accent */
    color?: string
  }>(),
  {
    height: '132px',
  },
)

function readTheme() {
  if (typeof document === 'undefined') {
    return {
      text: '#6b7280',
      foreground: '#111827',
      border: '#e5e7eb',
      surface: '#ffffff',
      accent: props.color || '#2563eb',
      mutedBg: '#f3f4f6',
    }
  }
  const style = getComputedStyle(document.documentElement)
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    text: pick('--rs-fg-muted', pick('--rs-muted', '#6b7280')),
    foreground: pick('--rs-fg', pick('--rs-foreground', '#111827')),
    border: pick('--rs-border-subtle', '#e5e7eb'),
    surface: pick('--rs-surface', pick('--rs-bg', '#ffffff')),
    accent: props.color || pick('--rs-accent', '#2563eb'),
    mutedBg: pick('--rs-bg-muted', '#f3f4f6'),
  }
}

function formatClock(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function formatAxisValue(n: number): string {
  if (props.formatValue) {
    const s = props.formatValue(n)
    // 轴标签过长时缩短（如带单位的字节）
    return s.length > 10 ? s.replace(/\s+/g, '') : s
  }
  if (!Number.isFinite(n)) return ''
  if (Math.abs(n) >= 1000) return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n)
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(1)
}

/** 将 CSS 颜色转为带 alpha 的 rgba，供 Canvas 渐变使用 */
function withAlpha(color: string, alpha: number): string {
  const c = color.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('')
    const r = Number.parseInt(h.slice(0, 2), 16)
    const g = Number.parseInt(h.slice(2, 4), 16)
    const b = Number.parseInt(h.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c)
  if (rgb) {
    return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`
  }
  return c
}

const series = computed(() =>
  props.values.map((v) => (v == null || !Number.isFinite(v) ? null : Number(v))),
)

const latestText = computed(() => {
  const nums = series.value.filter((v): v is number => v != null)
  const v = nums[nums.length - 1]
  if (v == null) return '—'
  return props.formatValue ? props.formatValue(v) : String(v)
})

const hasEnoughPoints = computed(() => series.value.filter((v) => v != null).length >= 2)

const option = computed((): EChartsOption => {
  const theme = readTheme()
  const data = series.value
  const ts = props.timestamps ?? []
  const categories = data.map((_, i) => {
    const t = ts[i]
    return t != null && Number.isFinite(t) ? formatClock(Number(t)) : String(i + 1)
  })

  const accent = theme.accent
  const areaTop = withAlpha(accent, 0.22)
  const areaBottom = withAlpha(accent, 0.02)

  return {
    animation: true,
    animationDuration: 280,
    animationDurationUpdate: 280,
    grid: {
      left: 4,
      right: 8,
      top: 10,
      bottom: 2,
      containLabel: true,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'line',
        lineStyle: { color: theme.border, type: 'dashed' },
      },
      backgroundColor: theme.surface,
      borderColor: theme.border,
      textStyle: { color: theme.foreground, fontSize: 11 },
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params]
        const p = list[0] as
          | { dataIndex?: number; axisValueLabel?: string; name?: string }
          | undefined
        if (!p) return ''
        const idx = typeof p.dataIndex === 'number' ? p.dataIndex : -1
        const raw = idx >= 0 ? data[idx] : null
        let valueText = '—'
        if (raw != null) {
          valueText = props.formatValue ? props.formatValue(raw) : String(raw)
        }
        let time = String(p.axisValueLabel ?? p.name ?? '')
        if (idx >= 0 && ts[idx] != null && Number.isFinite(Number(ts[idx]))) {
          time = formatClock(Number(ts[idx]))
        }
        const title = props.label ? `${props.label}<br/>` : ''
        return `${title}<span style="color:${theme.text}">${time}</span><br/><b>${valueText}</b>`
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: false,
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { show: false },
      axisLabel: {
        color: theme.text,
        fontSize: 10,
        hideOverlap: true,
        interval: 'auto',
        showMaxLabel: true,
        showMinLabel: true,
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: theme.text,
        fontSize: 10,
        formatter: (v: number) => formatAxisValue(v),
      },
      splitLine: {
        lineStyle: {
          color: theme.border,
          type: 'dashed',
          opacity: 0.85,
        },
      },
      splitNumber: 3,
    },
    series: [
      {
        type: 'line',
        data,
        showSymbol: data.length <= 2,
        symbol: 'circle',
        symbolSize: 5,
        smooth: 0.2,
        connectNulls: true,
        lineStyle: { width: 2, color: accent },
        itemStyle: { color: accent },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: areaTop },
              { offset: 1, color: areaBottom },
            ],
          },
        },
        emphasis: {
          focus: 'series',
          itemStyle: {
            borderColor: theme.surface,
            borderWidth: 2,
            shadowBlur: 6,
            shadowColor: accent,
          },
        },
      },
    ],
  }
})
</script>

<template>
  <div class="nm-ch-spark">
    <div class="nm-ch-spark__head">
      <span class="nm-ch-spark__label">{{ label }}</span>
      <span class="nm-ch-spark__value">{{ latestText }}</span>
    </div>
    <div class="nm-ch-spark__chart" :style="{ height }">
      <VChart
        v-if="hasEnoughPoints"
        class="nm-ch-spark__canvas"
        :option="option"
        autoresize
      />
      <div v-else class="nm-ch-spark__empty">…</div>
    </div>
  </div>
</template>

<style scoped>
.nm-ch-spark {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 6px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md, 6px);
  background: var(--rs-bg-elevated, var(--rs-bg-muted));
  min-width: 0;
}
.nm-ch-spark__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
}
.nm-ch-spark__label {
  font-size: 11px;
  font-weight: 600;
  color: var(--rs-fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.nm-ch-spark__value {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--rs-fg);
}
.nm-ch-spark__chart {
  width: 100%;
  min-height: 100px;
}
.nm-ch-spark__canvas {
  width: 100%;
  height: 100%;
}
.nm-ch-spark__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--rs-fg-muted);
  font-size: 12px;
}
</style>
