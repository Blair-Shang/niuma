/**
 * NiuMa 图表简表（nm:1）→ ECharts option。
 */
import type { EChartsOption } from 'echarts'

export type NmChartLite = {
  nm: 1
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'radar'
  title?: string
  x?: Array<string | number>
  series?: Array<{
    name?: string
    data?: unknown
  }>
  data?: Array<{ name: string; value: number } | number>
}

type ChartTheme = {
  text: string
  foreground: string
  border: string
  surface: string
  accent: string
}

function readChartTheme(): ChartTheme {
  if (typeof document === 'undefined') {
    return {
      text: '#94a3b8',
      foreground: '#e2e8f0',
      border: '#334155',
      surface: '#1e293b',
      accent: '#3b82f6',
    }
  }
  const style = getComputedStyle(document.documentElement)
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    text: pick('--rs-muted', '#94a3b8'),
    foreground: pick('--rs-text', pick('--rs-foreground', '#e2e8f0')),
    border: pick('--rs-border-subtle', '#334155'),
    surface: pick('--rs-surface-elevated', pick('--rs-surface-subtle', '#1e293b')),
    accent: pick('--rs-primary', pick('--rs-accent', '#3b82f6')),
  }
}

function isLite(v: unknown): v is NmChartLite {
  return Boolean(v && typeof v === 'object' && (v as NmChartLite).nm === 1 && (v as NmChartLite).type)
}

function baseTheme(opts?: {
  hasTitle?: boolean
  hasLegend?: boolean
}): Pick<EChartsOption, 'textStyle' | 'grid' | 'tooltip' | 'legend'> {
  const theme = readChartTheme()
  const hasTitle = Boolean(opts?.hasTitle)
  const hasLegend = opts?.hasLegend !== false
  // 标题与图例分层，避免叠字；给绘图区留出顶边距
  const gridTop = hasTitle && hasLegend ? 64 : hasTitle || hasLegend ? 44 : 28
  return {
    textStyle: { color: theme.foreground, fontSize: 11 },
    grid: { left: 48, right: 16, top: gridTop, bottom: 36 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: theme.surface,
      borderColor: theme.border,
      textStyle: { color: theme.foreground },
    },
    legend: hasLegend
      ? {
          type: 'scroll',
          top: hasTitle ? 30 : 6,
          left: 'center',
          width: '90%',
          itemWidth: 10,
          itemHeight: 10,
          itemGap: 12,
          textStyle: { color: theme.text, fontSize: 11 },
        }
      : { show: false },
  }
}

/** 将围栏 JSON 解析为 ECharts option（支持 nm:1 简表 / 完整 option / {option}）。 */
export function parseAiChartOption(raw: string): { option: EChartsOption | null; error: string | null } {
  const text = raw.trim()
  if (!text) {
    return { option: null, error: 'empty' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { option: null, error: e instanceof Error ? e.message : String(e) }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { option: null, error: 'not-object' }
  }
  const obj = parsed as Record<string, unknown>
  if ('option' in obj && obj.option && typeof obj.option === 'object') {
    return { option: normalizeFullOption(obj.option as EChartsOption), error: null }
  }
  if (isLite(parsed)) {
    return { option: liteToOption(parsed), error: null }
  }
  return { option: normalizeFullOption(parsed as EChartsOption), error: null }
}

/** 完整 option 也做一层标题/图例防重叠修正（不覆盖用户显式 layout）。 */
function normalizeFullOption(option: EChartsOption): EChartsOption {
  const next: EChartsOption = { ...option }
  const title = next.title
  const hasTitle = Boolean(
    (Array.isArray(title) ? title[0]?.text : title && 'text' in title ? title.text : '') || '',
  )
  if (hasTitle && next.legend && typeof next.legend === 'object' && !Array.isArray(next.legend)) {
    const legend = { ...next.legend }
    if (legend.top == null && legend.bottom == null) {
      legend.top = 30
      legend.left = legend.left ?? 'center'
    }
    next.legend = legend
  }
  if (hasTitle && next.grid && typeof next.grid === 'object' && !Array.isArray(next.grid)) {
    const grid = { ...next.grid }
    const top = grid.top
    if (top == null || (typeof top === 'number' && top < 56)) {
      grid.top = 64
    }
    next.grid = grid
  }
  return next
}

export function liteToOption(lite: NmChartLite): EChartsOption {
  const theme = readChartTheme()
  const seriesList = lite.series ?? []
  const namedSeries = seriesList.filter((s) => Boolean(s.name))
  // 单系列无名时可藏图例；有 name 或多样列才显示
  const showLegend = namedSeries.length > 0 || seriesList.length > 1
  const base = baseTheme({ hasTitle: Boolean(lite.title), hasLegend: showLegend })
  const title = lite.title
    ? {
        text: lite.title,
        left: 'center' as const,
        top: 6,
        textStyle: {
          color: theme.foreground,
          fontSize: 12,
          fontWeight: 600 as const,
          width: 320,
          overflow: 'truncate' as const,
        },
      }
    : undefined

  if (lite.type === 'pie') {
    const data =
      lite.data ??
      (Array.isArray(lite.series?.[0]?.data)
        ? (lite.series[0].data as Array<{ name: string; value: number }>)
        : [])
    return {
      ...baseTheme({ hasTitle: Boolean(lite.title), hasLegend: true }),
      title,
      tooltip: { trigger: 'item', backgroundColor: theme.surface, borderColor: theme.border },
      legend: {
        type: 'scroll',
        bottom: 4,
        left: 'center',
        textStyle: { color: theme.text, fontSize: 11 },
      },
      series: [
        {
          type: 'pie',
          radius: ['32%', '58%'],
          center: ['50%', '48%'],
          data: data as Array<{ name: string; value: number }>,
          label: { color: theme.text },
        },
      ],
    }
  }

  if (lite.type === 'radar') {
    const indicators = (lite.x ?? []).map((name) => ({ name: String(name), max: 100 }))
    return {
      ...base,
      title,
      radar: { indicator: indicators, center: ['50%', '55%'], axisName: { color: theme.text } },
      series: (lite.series ?? []).map((s) => ({
        type: 'radar' as const,
        name: s.name,
        data: [{ value: s.data as number[], name: s.name }],
      })),
    }
  }

  // pie / radar 已提前 return；笛卡尔系只剩 bar | line | scatter
  // ECharts SeriesOption 是按 type 判别的联合，联合字面量 type 无法直接赋给 series
  const cartesianType: 'bar' | 'line' | 'scatter' =
    lite.type === 'line' || lite.type === 'scatter' ? lite.type : 'bar'
  const xData = lite.x ?? []
  const palette = [theme.accent, '#34d399', '#f59e0b', '#a78bfa', '#f472b6']
  return {
    ...base,
    title,
    xAxis: {
      type: 'category',
      data: xData,
      axisLabel: { color: theme.text, hideOverlap: true, rotate: xData.length > 8 ? 30 : 0 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: theme.text },
      splitLine: { lineStyle: { color: theme.border } },
    },
    series: seriesList.map((s, i) => ({
      type: cartesianType,
      name: s.name,
      data: s.data as number[],
      smooth: cartesianType === 'line',
      showSymbol: cartesianType === 'scatter',
      itemStyle: { color: palette[i % palette.length] },
    })) as EChartsOption['series'],
  }
}
