<script setup lang="ts">
import { use } from 'echarts/core'
import type { EChartsOption } from 'echarts'
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import { GeoComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { computed } from 'vue'
import VChart from 'vue-echarts'

use([BarChart, LineChart, ScatterChart, GeoComponent, GridComponent, TooltipComponent, CanvasRenderer])

const props = withDefaults(
  defineProps<{
    option: EChartsOption | Record<string, unknown> | null
    height?: string
  }>(),
  {
    height: '120px',
  },
)

const chartOption = computed(() => props.option ?? {})
const visible = computed(() => props.option != null)
</script>

<template>
  <VChart
    v-if="visible"
    class="nm-schema-echart"
    :option="chartOption"
    autoresize
    :style="{ height }"
  />
</template>

<style scoped>
.nm-schema-echart {
  width: 100%;
  min-height: 80px;
}
</style>
