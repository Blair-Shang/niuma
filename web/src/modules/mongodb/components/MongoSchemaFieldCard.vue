<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EChartsOption } from 'echarts'
import { useI18n } from 'vue-i18n'
import type { MongoSchemaField } from '@/api/types/mongodb'
import SchemaEChart from '@/modules/mongodb/components/SchemaEChart.vue'
import {
  buildDateTimelineOption,
  buildNumberHistogramOption,
  buildStringDistributionOption,
  buildTypeBreakdownOption,
  loadGeoChartOption,
} from '@/modules/mongodb/utils/schema-chart-options'
import {
  formatSchemaDate,
  formatSchemaNumber,
  formatSchemaPercent,
  schemaTypeColor,
} from '@/modules/mongodb/utils/schema-type-colors'

const props = defineProps<{
  field: MongoSchemaField
}>()

const { t } = useI18n()

const typeBreakdown = computed(() =>
  props.field.typeBreakdown?.length
    ? props.field.typeBreakdown
    : props.field.types.map((type) => ({ type, frequency: props.field.frequency })),
)

const typeChartOption = computed(() => buildTypeBreakdownOption(typeBreakdown.value))
const numberChartOption = computed(() => buildNumberHistogramOption(props.field))
const stringChartOption = computed(() => buildStringDistributionOption(props.field))
const dateChartOption = computed(() => buildDateTimelineOption(props.field))
const geoChartOption = ref<EChartsOption | null>(null)

watch(
  () => props.field,
  (field) => {
    geoChartOption.value = null
    if (!field.geoStats?.points.length) return
    void loadGeoChartOption(field).then((option) => {
      geoChartOption.value = option
    })
  },
  { immediate: true, deep: true },
)

const hasDistribution = computed(
  () =>
    !!numberChartOption.value
    || !!stringChartOption.value
    || !!dateChartOption.value
    || !!geoChartOption.value
    || !!props.field.samples?.length,
)
</script>

<template>
  <article class="nm-schema-card">
    <header class="nm-schema-card__head">
      <div class="nm-schema-card__title-row">
        <h3 class="nm-schema-card__path">{{ field.path }}</h3>
        <span class="nm-schema-card__freq">{{ formatSchemaPercent(field.frequency) }}</span>
      </div>

      <SchemaEChart :option="typeChartOption" height="18px" class="nm-schema-card__type-chart" />

      <div class="nm-schema-card__type-labels">
        <span
          v-for="item in typeBreakdown"
          :key="`label-${item.type}`"
          class="nm-schema-card__type-chip"
        >
          <span class="nm-schema-card__type-dot" :style="{ background: schemaTypeColor(item.type) }" />
          <span class="nm-schema-card__type-name">{{ item.type }}</span>
          <span class="nm-schema-card__type-pct">{{ formatSchemaPercent(item.frequency) }}</span>
        </span>
      </div>
    </header>

    <div v-if="hasDistribution" class="nm-schema-card__body">
      <section v-if="numberChartOption" class="nm-schema-card__section">
        <div class="nm-schema-card__section-head">
          <span class="nm-schema-card__section-title">{{ t('modules.mongodb.schema.numberRange') }}</span>
          <span v-if="field.numberStats" class="nm-schema-card__section-meta">
            {{ formatSchemaNumber(field.numberStats.min) }} – {{ formatSchemaNumber(field.numberStats.max) }}
          </span>
        </div>
        <SchemaEChart :option="numberChartOption" height="140px" />
      </section>

      <section v-if="dateChartOption" class="nm-schema-card__section">
        <div class="nm-schema-card__section-head">
          <span class="nm-schema-card__section-title">{{ t('modules.mongodb.schema.dateRange') }}</span>
          <span v-if="field.dateStats" class="nm-schema-card__section-meta">
            {{ formatSchemaDate(field.dateStats.min) }} – {{ formatSchemaDate(field.dateStats.max) }}
          </span>
        </div>
        <SchemaEChart :option="dateChartOption" height="140px" />
      </section>

      <section v-if="stringChartOption" class="nm-schema-card__section">
        <div class="nm-schema-card__section-head">
          <span class="nm-schema-card__section-title">{{ t('modules.mongodb.schema.topValues') }}</span>
        </div>
        <SchemaEChart :option="stringChartOption" :height="`${Math.max(80, (field.stringStats?.topValues.length ?? 0) * 28)}px`" />
      </section>

      <section v-if="geoChartOption" class="nm-schema-card__section">
        <div class="nm-schema-card__section-head">
          <span class="nm-schema-card__section-title">{{ t('modules.mongodb.schema.geoMap') }}</span>
          <span class="nm-schema-card__section-meta">
            {{ t('modules.mongodb.schema.geoPoints', { count: field.geoStats?.points.length ?? 0 }) }}
          </span>
        </div>
        <SchemaEChart :option="geoChartOption" height="200px" />
      </section>

      <section v-if="field.samples?.length" class="nm-schema-card__section">
        <div class="nm-schema-card__section-head">
          <span class="nm-schema-card__section-title">{{ t('modules.mongodb.schema.samples') }}</span>
        </div>
        <div class="nm-schema-card__samples">
          <code v-for="sample in field.samples" :key="sample" class="nm-schema-card__sample">{{ sample }}</code>
        </div>
      </section>
    </div>
  </article>
</template>

<style scoped>
.nm-schema-card {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface);
  overflow: hidden;
}

.nm-schema-card__head {
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-schema-card__title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  margin-bottom: 8px;
}

.nm-schema-card__path {
  margin: 0;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-foreground);
  word-break: break-all;
}

.nm-schema-card__freq {
  flex-shrink: 0;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-schema-card__type-chart {
  margin-bottom: 8px;
}

.nm-schema-card__type-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.nm-schema-card__type-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-schema-card__type-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.nm-schema-card__type-name {
  font-family: var(--rs-font-mono);
}

.nm-schema-card__type-pct {
  color: var(--rs-placeholder);
}

.nm-schema-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding: var(--rs-space-sm) var(--rs-space-md) var(--rs-space-md);
}

.nm-schema-card__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  margin-bottom: 6px;
}

.nm-schema-card__section-title {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.nm-schema-card__section-meta {
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-foreground);
}

.nm-schema-card__samples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.nm-schema-card__sample {
  padding: 2px 8px;
  border-radius: var(--rs-radius-xs);
  background: var(--rs-surface-subtle);
  border: 1px solid var(--rs-border-subtle);
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-foreground);
}
</style>
