<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, useTemplateRef, watch } from 'vue'
import { useRsI18n } from '../composables/useRsI18n'
import {
  parseTimeValue,
  rangeInclusive,
  scheduleAfterPaint,
} from './time-picker-utils'

const model = defineModel<string>({ default: '00:00' })

const props = withDefaults(
  defineProps<{
    minuteStep?: number
    second?: boolean
    disabled?: boolean
    isUnitDisabled?: (unit: 'hour' | 'minute' | 'second', value: number) => boolean
  }>(),
  {
    minuteStep: 1,
    second: false,
    disabled: false,
  },
)

const { t } = useRsI18n()

const hourListRef = useTemplateRef<HTMLDivElement>('hourListRef')
const minuteListRef = useTemplateRef<HTMLDivElement>('minuteListRef')
const secondListRef = useTemplateRef<HTMLDivElement>('secondListRef')

let cancelScheduledScroll: (() => void) | undefined

const hourOptions = computed(() => rangeInclusive(23))
const minuteOptions = computed(() =>
  rangeInclusive(59).filter((value) => value % props.minuteStep === 0),
)
const secondOptions = computed(() => rangeInclusive(59))

const parts = computed(() => {
  const parsed = parseTimeValue(model.value, props.second)
  if (parsed) {
    return { hour: parsed.hour, minute: parsed.minute, second: parsed.second }
  }
  return { hour: 0, minute: 0, second: 0 }
})

function isDisabled(unit: 'hour' | 'minute' | 'second', value: number): boolean {
  return props.isUnitDisabled?.(unit, value) ?? false
}

function scrollColumn(
  container: HTMLDivElement | null,
  unit: 'hour' | 'minute' | 'second',
  value: number,
): void {
  if (!container) return
  const selected = container.querySelector<HTMLElement>(
    `[data-unit="${unit}"][data-value="${value}"]`,
  )
  selected?.scrollIntoView({ block: 'center', behavior: 'auto' })
}

function scrollToSelection(): void {
  scrollColumn(hourListRef.value, 'hour', parts.value.hour)
  scrollColumn(minuteListRef.value, 'minute', parts.value.minute)
  if (props.second) {
    scrollColumn(secondListRef.value, 'second', parts.value.second)
  }
}

function scrollToSelectionAfterPaint(): void {
  cancelScheduledScroll?.()
  cancelScheduledScroll = scheduleAfterPaint(scrollToSelection)
}

function selectUnit(unit: 'hour' | 'minute' | 'second', value: number): void {
  if (isDisabled(unit, value) || props.disabled) return
  const next = { ...parts.value, [unit]: value }
  model.value = props.second
    ? `${String(next.hour).padStart(2, '0')}:${String(next.minute).padStart(2, '0')}:${String(next.second).padStart(2, '0')}`
    : `${String(next.hour).padStart(2, '0')}:${String(next.minute).padStart(2, '0')}`
}

watch(
  () => [parts.value.hour, parts.value.minute, parts.value.second, props.second] as const,
  () => {
    nextTick(scrollToSelection)
  },
  { flush: 'post' },
)

onMounted(() => {
  scrollToSelectionAfterPaint()
})

onUnmounted(() => {
  cancelScheduledScroll?.()
})

defineExpose({
  scrollToSelection,
  scrollToSelectionAfterPaint,
})
</script>

<template>
  <div class="rs-time-columns" :class="{ 'rs-time-columns--seconds': second }">
    <div class="rs-time-columns__column">
      <span class="rs-time-columns__label">{{ t('timePicker.hour') }}</span>
      <div ref="hourListRef" class="rs-time-columns__list">
        <button
          v-for="option in hourOptions"
          :key="option"
          type="button"
          class="rs-time-columns__item"
          :class="{ 'rs-time-columns__item--active': parts.hour === option }"
          data-unit="hour"
          :data-value="option"
          :disabled="disabled || isDisabled('hour', option)"
          @click="selectUnit('hour', option)"
        >
          {{ String(option).padStart(2, '0') }}
        </button>
      </div>
    </div>

    <div class="rs-time-columns__column">
      <span class="rs-time-columns__label">{{ t('timePicker.minute') }}</span>
      <div ref="minuteListRef" class="rs-time-columns__list">
        <button
          v-for="option in minuteOptions"
          :key="option"
          type="button"
          class="rs-time-columns__item"
          :class="{ 'rs-time-columns__item--active': parts.minute === option }"
          data-unit="minute"
          :data-value="option"
          :disabled="disabled || isDisabled('minute', option)"
          @click="selectUnit('minute', option)"
        >
          {{ String(option).padStart(2, '0') }}
        </button>
      </div>
    </div>

    <div v-if="second" class="rs-time-columns__column">
      <span class="rs-time-columns__label">{{ t('timePicker.second') }}</span>
      <div ref="secondListRef" class="rs-time-columns__list">
        <button
          v-for="option in secondOptions"
          :key="option"
          type="button"
          class="rs-time-columns__item"
          :class="{ 'rs-time-columns__item--active': parts.second === option }"
          data-unit="second"
          :data-value="option"
          :disabled="disabled || isDisabled('second', option)"
          @click="selectUnit('second', option)"
        >
          {{ String(option).padStart(2, '0') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rs-time-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--rs-space-sm);
}
.rs-time-columns--seconds {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.rs-time-columns__column {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.25rem;
}
.rs-time-columns__label {
  text-align: center;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--rs-muted);
}
.rs-time-columns__list {
  max-height: 10rem;
  overflow-y: auto;
  padding: 0.25rem;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-surface) 72%, transparent);
}
.rs-time-columns__item {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--rs-radius-sm);
  padding: 0.375rem 0;
  background: transparent;
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  cursor: pointer;
  transition: background var(--rs-transition-fast), color var(--rs-transition-fast);
}
.rs-time-columns__item:hover:not(:disabled) {
  background: var(--rs-surface-hover);
}
.rs-time-columns__item--active {
  background: var(--rs-primary);
  color: var(--rs-primary-foreground);
}
.rs-time-columns__item--active:hover:not(:disabled) {
  opacity: 0.92;
}
.rs-time-columns__item:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
</style>
