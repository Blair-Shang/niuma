<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  formatDateParts,
  parseDateValue,
  type RsParsedDate,
  RsCalendarGrid,
} from '@ruoshui/ui'
import DemoBlock from '../components/DemoBlock.vue'
import DemoPage from '../components/DemoPage.vue'

const selected = ref('')
const preset = ref('2025-06-16')
const bookingDate = ref('')

const selectedView = ref({ year: 2025, month: 6 })
const presetView = ref({ year: 2025, month: 6 })
const fixedView = ref({ year: 2025, month: 6 })
const bookingView = ref({ year: 2025, month: 6 })

const rangeStart = ref<RsParsedDate | null>(null)
const rangeEnd = ref<RsParsedDate | null>(null)
const rangeView = ref({ year: 2025, month: 6 })

const disabledDates = [
  '2025-06-01',
  '2025-06-07',
  '2025-06-08',
  '2025-06-14',
  '2025-06-15',
  '2025-06-21',
  '2025-06-22',
  '2025-06-28',
  '2025-06-29',
]

const selectedDate = computed(() => parseDateValue(selected.value))
const presetDate = computed(() => parseDateValue(preset.value))
const bookingDateParsed = computed(() => parseDateValue(bookingDate.value))

function onRangeSelect(date: RsParsedDate): void {
  if (!rangeStart.value || (rangeStart.value && rangeEnd.value)) {
    rangeStart.value = date
    rangeEnd.value = null
    return
  }
  const startNum = rangeStart.value.year * 10000 + rangeStart.value.month * 100 + rangeStart.value.day
  const nextNum = date.year * 10000 + date.month * 100 + date.day
  if (nextNum < startNum) {
    rangeEnd.value = rangeStart.value
    rangeStart.value = date
    return
  }
  rangeEnd.value = date
}
</script>

<template>
  <DemoPage title="RsCalendarGrid" test-file="RsCalendarGrid.spec.ts">
    <DemoBlock title="基础日期选择">
      <p class="hint">
        通过 <code>@select</code> 接收 <code>RsParsedDate</code>，配合
        <code>v-model:view-year</code> / <code>v-model:view-month</code> 控制展示月份。
      </p>
      <div class="calendar-panel">
        <RsCalendarGrid
          v-model:view-year="selectedView.year"
          v-model:view-month="selectedView.month"
          :selected="selectedDate"
          @select="(date) => (selected = formatDateParts(date))"
        />
      </div>
      <p class="value">当前选中：<code>{{ selected || '未选择' }}</code></p>
    </DemoBlock>

    <DemoBlock title="预选日期">
      <p class="hint">传入 <code>:selected</code> 时对应单元格呈现选中态。</p>
      <div class="calendar-panel">
        <RsCalendarGrid
          v-model:view-year="presetView.year"
          v-model:view-month="presetView.month"
          :selected="presetDate"
          @select="(date) => (preset = formatDateParts(date))"
        />
      </div>
      <p class="value">当前选中：<code>{{ preset }}</code></p>
    </DemoBlock>

    <DemoBlock title="范围高亮">
      <p class="hint">
        传入 <code>:range-start</code> / <code>:range-end</code> 展示范围背景，点击逻辑由父组件处理。
      </p>
      <div class="calendar-panel">
        <RsCalendarGrid
          v-model:view-year="rangeView.year"
          v-model:view-month="rangeView.month"
          :range-start="rangeStart"
          :range-end="rangeEnd"
          @select="onRangeSelect"
        />
      </div>
      <p class="value">
        范围：
        <code>{{ rangeStart ? formatDateParts(rangeStart) : '—' }}</code>
        ~
        <code>{{ rangeEnd ? formatDateParts(rangeEnd) : '—' }}</code>
      </p>
    </DemoBlock>

    <DemoBlock title="禁用日期 disabledDates">
      <p class="hint">传入 <code>disabledDates</code> 后对应日期不可点击。</p>
      <div class="calendar-panel">
        <RsCalendarGrid
          v-model:view-year="bookingView.year"
          v-model:view-month="bookingView.month"
          :selected="bookingDateParsed"
          :disabled-dates="disabledDates"
          @select="(date) => (bookingDate = formatDateParts(date))"
        />
      </div>
      <p class="value">可预约日期：<code>{{ bookingDate || '请选择可用日期' }}</code></p>
    </DemoBlock>

    <DemoBlock title="固定月份浏览">
      <div class="calendar-panel">
        <RsCalendarGrid
          v-model:view-year="fixedView.year"
          v-model:view-month="fixedView.month"
          :selected="selectedDate"
          @select="(date) => (selected = formatDateParts(date))"
        />
      </div>
    </DemoBlock>
  </DemoPage>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
.hint code {
  font-size: 0.85em;
  color: var(--rs-text);
}
.calendar-panel {
  max-width: 20rem;
  padding: 0.75rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface-elevated);
}
.value {
  margin: 0.75rem 0 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}
.value code {
  color: var(--rs-text);
}
</style>
