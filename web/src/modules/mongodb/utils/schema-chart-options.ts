import type { EChartsOption } from 'echarts'
import type {
  MongoSchemaField,
  MongoSchemaTypeStat,
} from '@/api/types/mongodb'
import {
  formatSchemaDate,
  formatSchemaNumber,
  formatSchemaPercent,
  schemaTypeColor,
} from '@/modules/mongodb/utils/schema-type-colors'
import { ensureWorldMap, isWorldMapReady } from '@/modules/mongodb/utils/schema-geo-map'
import { readSchemaChartTheme } from '@/modules/mongodb/utils/schema-chart-theme'

function baseGrid(theme: ReturnType<typeof readSchemaChartTheme>) {
  return {
    left: 8,
    right: 8,
    top: 8,
    bottom: 8,
    outerBoundsMode: 'same' as const,
    outerBoundsContain: 'axisLabel' as const,
    borderColor: theme.border,
  }
}

function tooltip(theme: ReturnType<typeof readSchemaChartTheme>) {
  return {
    trigger: 'axis' as const,
    axisPointer: { type: 'shadow' as const },
    backgroundColor: theme.surface,
    borderColor: theme.border,
    textStyle: { color: theme.foreground, fontSize: 11 },
  }
}

export function buildTypeBreakdownOption(
  breakdown: MongoSchemaTypeStat[],
): EChartsOption {
  const theme = readSchemaChartTheme()
  return {
    animation: false,
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    xAxis: { type: 'value', show: false, max: 1 },
    yAxis: { type: 'category', show: false, data: ['type'] },
    series: [{
      type: 'bar',
      stack: 'total',
      barWidth: 10,
      data: breakdown.map((item) => ({
        value: item.frequency,
        itemStyle: { color: schemaTypeColor(item.type), borderRadius: 2 },
        name: item.type,
      })),
    }],
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        if (!p || typeof p !== 'object' || !('name' in p)) return ''
        const value = typeof p.value === 'number' ? p.value : 0
        return `${String(p.name)}: ${formatSchemaPercent(value)}`
      },
      backgroundColor: theme.surface,
      borderColor: theme.border,
      textStyle: { color: theme.foreground, fontSize: 11 },
    },
  }
}

export function buildNumberHistogramOption(
  field: MongoSchemaField,
): EChartsOption | null {
  const buckets = field.numberStats?.buckets
  if (!buckets?.length) return null
  const theme = readSchemaChartTheme()
  return {
    animation: false,
    grid: baseGrid(theme),
    tooltip: tooltip(theme),
    xAxis: {
      type: 'category',
      data: buckets.map((b) => formatSchemaNumber(b.from)),
      axisLabel: { color: theme.text, fontSize: 10, rotate: buckets.length > 6 ? 35 : 0 },
      axisLine: { lineStyle: { color: theme.border } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: theme.text, fontSize: 10, formatter: (v: number) => formatSchemaPercent(v) },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
    },
    series: [{
      type: 'bar',
      data: buckets.map((b) => b.frequency),
      itemStyle: { color: theme.accent, borderRadius: [3, 3, 0, 0] },
    }],
  }
}

export function buildStringDistributionOption(
  field: MongoSchemaField,
): EChartsOption | null {
  const topValues = field.stringStats?.topValues
  if (!topValues?.length) return null
  const theme = readSchemaChartTheme()
  const labels = topValues.map((item) => item.value)
  return {
    animation: false,
    grid: { ...baseGrid(theme), left: 4 },
    tooltip: tooltip(theme),
    xAxis: {
      type: 'value',
      max: 1,
      axisLabel: { color: theme.text, fontSize: 10, formatter: (v: number) => formatSchemaPercent(v) },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        color: theme.foreground,
        fontSize: 10,
        width: 120,
        overflow: 'truncate',
      },
      axisLine: { lineStyle: { color: theme.border } },
    },
    series: [{
      type: 'bar',
      data: topValues.map((item) => item.frequency),
      itemStyle: { color: '#3b82f6', borderRadius: [0, 3, 3, 0] },
    }],
  }
}

export function buildDateTimelineOption(
  field: MongoSchemaField,
): EChartsOption | null {
  const buckets = field.dateStats?.buckets
  if (!buckets?.length) return null
  const theme = readSchemaChartTheme()
  return {
    animation: false,
    grid: baseGrid(theme),
    tooltip: {
      ...tooltip(theme),
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        if (!p || typeof p !== 'object' || typeof p.dataIndex !== 'number') return ''
        const bucket = buckets[p.dataIndex]
        if (!bucket) return ''
        return `${formatSchemaDate(bucket.from)} – ${formatSchemaDate(bucket.to)}<br/>${formatSchemaPercent(bucket.frequency)}`
      },
    },
    xAxis: {
      type: 'category',
      data: buckets.map((b) => formatSchemaDate(b.from)),
      axisLabel: { color: theme.text, fontSize: 10, rotate: 30 },
      axisLine: { lineStyle: { color: theme.border } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: theme.text, fontSize: 10, formatter: (v: number) => formatSchemaPercent(v) },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
    },
    series: [{
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      areaStyle: { color: 'rgba(34, 197, 94, 0.15)' },
      lineStyle: { color: '#22c55e', width: 2 },
      itemStyle: { color: '#22c55e' },
      data: buckets.map((b) => b.frequency),
    }],
  }
}

export function buildGeoScatterOption(
  field: MongoSchemaField,
): EChartsOption | null {
  const points = field.geoStats?.points
  if (!points?.length) return null
  if (isWorldMapReady()) {
    return buildGeoMapOption(field)
  }
  return buildGeoCartesianOption(field)
}

/** 在世界地图上渲染坐标散点（需先 ensureWorldMap）。 */
export function buildGeoMapOption(field: MongoSchemaField): EChartsOption | null {
  const points = field.geoStats?.points
  if (!points?.length) return null
  const theme = readSchemaChartTheme()
  return {
    animation: false,
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        if (!p || !Array.isArray(p.value)) return ''
        return `lng: ${p.value[0]}<br/>lat: ${p.value[1]}`
      },
      backgroundColor: theme.surface,
      borderColor: theme.border,
      textStyle: { color: theme.foreground, fontSize: 11 },
    },
    geo: {
      map: 'world',
      roam: true,
      label: { show: false },
      itemStyle: {
        areaColor: theme.surface,
        borderColor: theme.border,
      },
      emphasis: {
        disabled: true,
      },
    },
    series: [{
      type: 'scatter',
      coordinateSystem: 'geo',
      symbolSize: 8,
      itemStyle: { color: '#14b8a6' },
      data: points.map((p) => [p.lng, p.lat]),
    }],
  }
}

/** 地图未加载时的笛卡尔坐标回退图。 */
function buildGeoCartesianOption(field: MongoSchemaField): EChartsOption | null {
  const points = field.geoStats?.points
  if (!points?.length) return null
  const theme = readSchemaChartTheme()
  const data = points.map((p) => [p.lng, p.lat])
  const lngs = points.map((p) => p.lng)
  const lats = points.map((p) => p.lat)
  const lngPad = Math.max((Math.max(...lngs) - Math.min(...lngs)) * 0.1, 0.5)
  const latPad = Math.max((Math.max(...lats) - Math.min(...lats)) * 0.1, 0.5)

  return {
    animation: false,
    grid: baseGrid(theme),
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        if (!p || !Array.isArray(p.value)) return ''
        return `lng: ${p.value[0]}<br/>lat: ${p.value[1]}`
      },
      backgroundColor: theme.surface,
      borderColor: theme.border,
      textStyle: { color: theme.foreground, fontSize: 11 },
    },
    xAxis: {
      type: 'value',
      name: 'lng',
      min: Math.min(...lngs) - lngPad,
      max: Math.max(...lngs) + lngPad,
      axisLabel: { color: theme.text, fontSize: 10 },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
    },
    yAxis: {
      type: 'value',
      name: 'lat',
      min: Math.min(...lats) - latPad,
      max: Math.max(...lats) + latPad,
      axisLabel: { color: theme.text, fontSize: 10 },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
    },
    series: [{
      type: 'scatter',
      symbolSize: 8,
      itemStyle: { color: '#14b8a6' },
      data,
    }],
  }
}

/** 预加载世界地图并返回可用的地理图表 option。 */
export async function loadGeoChartOption(
  field: MongoSchemaField,
): Promise<EChartsOption | null> {
  const points = field.geoStats?.points
  if (!points?.length) return null
  try {
    await ensureWorldMap()
    return buildGeoMapOption(field)
  } catch {
    return buildGeoCartesianOption(field)
  }
}
