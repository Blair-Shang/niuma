<script setup lang="ts">
import { computed } from 'vue'
import RsIcon from './RsIcon.vue'
import { useRsI18n } from '../composables/useRsI18n'
import {
  buildCalendarGrid,
  formatDateParts,
  isDateBetweenParsed,
  isDateWithinBounds,
  isSameDate,
  type RsCalendarCell,
  type RsParsedDate,
} from './date-picker-utils'

const viewYear = defineModel<number>('viewYear', { required: true })
const viewMonth = defineModel<number>('viewMonth', { required: true })

const props = withDefaults(
  defineProps<{
    selected?: RsParsedDate | null
    rangeStart?: RsParsedDate | null
    rangeEnd?: RsParsedDate | null
    minDate?: string
    maxDate?: string
    disabledDates?: string[]
  }>(),
  {
    selected: null,
    rangeStart: null,
    rangeEnd: null,
    disabledDates: () => [],
  },
)

const emit = defineEmits<{
  select: [date: RsParsedDate]
}>()

const { t, locale } = useRsI18n()

const weekdayLabels = computed(() => {
  const formatter = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  const monday = new Date(2024, 0, 1)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return formatter.format(date)
  })
})

const monthLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'long',
  }).format(new Date(viewYear.value, viewMonth.value - 1, 1)),
)

const cells = computed(() => buildCalendarGrid(viewYear.value, viewMonth.value))

const weeks = computed(() => {
  const rows: RsCalendarCell[][] = []
  for (let index = 0; index < cells.value.length; index += 7) {
    rows.push(cells.value.slice(index, index + 7))
  }
  return rows
})

function goPrevMonth(): void {
  if (viewMonth.value === 1) {
    viewYear.value -= 1
    viewMonth.value = 12
    return
  }
  viewMonth.value -= 1
}

function goNextMonth(): void {
  if (viewMonth.value === 12) {
    viewYear.value += 1
    viewMonth.value = 1
    return
  }
  viewMonth.value += 1
}

function isSelected(cell: RsCalendarCell): boolean {
  return props.selected ? isSameDate(props.selected, cell) : false
}

function isRangeStart(cell: RsCalendarCell): boolean {
  return props.rangeStart ? isSameDate(props.rangeStart, cell) : false
}

function isRangeEnd(cell: RsCalendarCell): boolean {
  return props.rangeEnd ? isSameDate(props.rangeEnd, cell) : false
}

function isInRange(cell: RsCalendarCell): boolean {
  if (!props.rangeStart || !props.rangeEnd) return false
  return isDateBetweenParsed(cell, props.rangeStart, props.rangeEnd)
}

function isDisabled(cell: RsCalendarCell): boolean {
  const iso = formatDateParts(cell)
  if (props.disabledDates.includes(iso)) return true
  return !isDateWithinBounds(cell.year, cell.month, cell.day, {
    minDate: props.minDate,
    maxDate: props.maxDate,
  })
}

function cellClass(cell: RsCalendarCell): Record<string, boolean> {
  const endpoint = isRangeStart(cell) || isRangeEnd(cell)
  const inRange = isInRange(cell)
  const selected = isSelected(cell)

  return {
    'rs-calendar-grid__cell--outside': !cell.inCurrentMonth,
    'rs-calendar-grid__cell--selected': selected,
    'rs-calendar-grid__cell--range-start': isRangeStart(cell),
    'rs-calendar-grid__cell--range-end': isRangeEnd(cell),
    'rs-calendar-grid__cell--in-range': inRange && !endpoint,
    'rs-calendar-grid__cell--endpoint': endpoint || selected,
  }
}

function selectDate(cell: RsCalendarCell): void {
  if (isDisabled(cell)) return
  emit('select', { year: cell.year, month: cell.month, day: cell.day })
}
</script>

<template>
  <div class="rs-calendar-grid">
    <div class="rs-calendar-grid__header">
      <button
        type="button"
        class="rs-calendar-grid__nav"
        :aria-label="t('datePicker.prevMonth')"
        @click="goPrevMonth"
      >
        <RsIcon name="chevron-left" :size="16" />
      </button>
      <span class="rs-calendar-grid__title">{{ monthLabel }}</span>
      <button
        type="button"
        class="rs-calendar-grid__nav"
        :aria-label="t('datePicker.nextMonth')"
        @click="goNextMonth"
      >
        <RsIcon name="chevron-right" :size="16" />
      </button>
    </div>

    <table class="rs-calendar-grid__table">
      <thead>
        <tr>
          <th
            v-for="(label, index) in weekdayLabels"
            :key="index"
            scope="col"
            class="rs-calendar-grid__weekday"
          >
            {{ label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(week, weekIndex) in weeks" :key="weekIndex">
          <td
            v-for="cell in week"
            :key="formatDateParts(cell)"
            class="rs-calendar-grid__day"
          >
            <button
              type="button"
              class="rs-calendar-grid__cell"
              :class="cellClass(cell)"
              :disabled="isDisabled(cell)"
              @click="selectDate(cell)"
            >
              {{ cell.day }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.rs-calendar-grid {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}
.rs-calendar-grid__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
}
.rs-calendar-grid__title {
  flex: 1;
  text-align: center;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-text);
}
.rs-calendar-grid__nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: 0;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  transition: background var(--rs-transition-fast), color var(--rs-transition-fast);
}
.rs-calendar-grid__nav:hover {
  background: var(--rs-surface-hover);
  color: var(--rs-text);
}
.rs-calendar-grid__table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 2px;
  table-layout: fixed;
}
.rs-calendar-grid__weekday {
  padding: 0.125rem 0;
  text-align: center;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--rs-muted);
}
.rs-calendar-grid__day {
  padding: 0;
  text-align: center;
  vertical-align: middle;
}
.rs-calendar-grid__cell {
  width: 100%;
  height: 2rem;
  border: 0;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}
.rs-calendar-grid__cell:hover:not(:disabled) {
  background: var(--rs-item-hover);
}
.rs-calendar-grid__cell--outside {
  color: var(--rs-placeholder);
}
.rs-calendar-grid__cell--endpoint,
.rs-calendar-grid__cell--selected {
  background: var(--rs-primary);
  color: var(--rs-primary-foreground);
}
.rs-calendar-grid__cell--in-range {
  border-radius: 0;
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
  color: var(--rs-primary);
}
.rs-calendar-grid__cell--range-start:not(.rs-calendar-grid__cell--range-end) {
  border-radius: var(--rs-radius-sm) 0 0 var(--rs-radius-sm);
}
.rs-calendar-grid__cell--range-end:not(.rs-calendar-grid__cell--range-start) {
  border-radius: 0 var(--rs-radius-sm) var(--rs-radius-sm) 0;
}
.rs-calendar-grid__cell:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
</style>
