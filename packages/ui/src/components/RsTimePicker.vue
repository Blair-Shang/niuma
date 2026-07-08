<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from './reka'
import RsIcon from './RsIcon.vue'
import RsTimePickerColumns from './RsTimePickerColumns.vue'
import { useRsI18n } from '../composables/useRsI18n'
import {
  EMPTY_TIME_RANGE,
  formatTimeFromParts,
  formatTimeRangeDisplay,
  getCurrentTime,
  isTimeRangeEmpty,
  isTimeRangeOrderedValues,
  isTimeWithinBounds,
  parseTimeValue,
  pickEarlierTime,
  pickLaterTime,
  type RsTimeRangeValue,
} from './time-picker-utils'

defineOptions({ name: 'RsTimePicker' })

export type { RsTimeRangeValue } from './time-picker-utils'
export type RsTimePickerLabelPosition = 'top' | 'left'

function isTimeRangeModel(value: string | RsTimeRangeValue): value is RsTimeRangeValue {
  return typeof value === 'object' && value !== null && ('start' in value || 'end' in value)
}

const model = defineModel<string | RsTimeRangeValue>({ default: '' })
const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    label?: string
    hint?: string
    placeholder?: string
    disabled?: boolean
    required?: boolean
    range?: boolean
    withSeconds?: boolean
    minTime?: string
    maxTime?: string
    embedded?: boolean
    labelPosition?: RsTimePickerLabelPosition
  }>(),
  {
    disabled: false,
    required: false,
    range: false,
    withSeconds: false,
    embedded: false,
    labelPosition: 'top',
  },
)

const fieldId = useId()
const { t } = useRsI18n()
const columnsRef = useTemplateRef<InstanceType<typeof RsTimePickerColumns>>('columnsRef')

const draftHour = ref(0)
const draftMinute = ref(0)
const draftSecond = ref(0)
const draftStartTime = ref('')
const draftEndTime = ref('')

const rangeModel = computed<RsTimeRangeValue>({
  get() {
    if (!props.range) return { ...EMPTY_TIME_RANGE }
    return isTimeRangeModel(model.value) ? model.value : { ...EMPTY_TIME_RANGE }
  },
  set(value) {
    model.value = value
  },
})

const singleModel = computed({
  get() {
    if (props.range) return ''
    return typeof model.value === 'string' ? model.value : ''
  },
  set(value: string) {
    model.value = value
  },
})

const startMaxTime = computed(() =>
  pickEarlierTime(props.maxTime, draftEndTime.value, props.withSeconds),
)

const endMinTime = computed(() =>
  pickLaterTime(props.minTime, draftStartTime.value, props.withSeconds),
)

const isEmpty = computed(() =>
  props.range ? isTimeRangeEmpty(rangeModel.value) : !singleModel.value,
)

const displayValue = computed(() => {
  if (props.range) {
    const formatted = formatTimeRangeDisplay(rangeModel.value, {
      separator: t('timePicker.separator'),
    })
    if (formatted) return formatted
    return props.placeholder ?? t('timePicker.rangePlaceholder')
  }

  if (!singleModel.value) {
    return props.placeholder ?? (props.embedded ? t('timePicker.embeddedPlaceholder') : t('timePicker.placeholder'))
  }
  return singleModel.value
})

const draftTime = computed({
  get() {
    return formatTimeFromParts(
      draftHour.value,
      draftMinute.value,
      draftSecond.value,
      props.withSeconds,
    )
  },
  set(value: string) {
    const parsed = parseTimeValue(value, props.withSeconds)
    if (!parsed) return
    draftHour.value = parsed.hour
    draftMinute.value = parsed.minute
    draftSecond.value = parsed.second
  },
})

function syncSingleDraft(): void {
  const parsed = parseTimeValue(singleModel.value, props.withSeconds)
  if (parsed) {
    draftHour.value = parsed.hour
    draftMinute.value = parsed.minute
    draftSecond.value = parsed.second
    return
  }

  const current = getCurrentTime()
  draftHour.value = current.hour
  draftMinute.value = current.minute
  draftSecond.value = current.second
}

function syncRangeDraft(): void {
  const start = parseTimeValue(rangeModel.value.start, props.withSeconds)
  const end = parseTimeValue(rangeModel.value.end, props.withSeconds)
  const current = getCurrentTime()

  draftStartTime.value = start
    ? formatTimeFromParts(start.hour, start.minute, start.second, props.withSeconds)
    : formatTimeFromParts(9, 0, 0, props.withSeconds)

  draftEndTime.value = end
    ? formatTimeFromParts(end.hour, end.minute, end.second, props.withSeconds)
    : formatTimeFromParts(
        start?.hour ?? Math.min(current.hour + 1, 23),
        start?.minute ?? current.minute,
        start?.second ?? current.second,
        props.withSeconds,
      )
}

function syncDraftFromModel(): void {
  if (props.range) {
    syncRangeDraft()
    return
  }
  syncSingleDraft()
}

function isUnitDisabled(unit: 'hour' | 'minute' | 'second', value: number): boolean {
  const hour = unit === 'hour' ? value : draftHour.value
  const minute = unit === 'minute' ? value : draftMinute.value
  const second = unit === 'second' ? value : draftSecond.value
  return !isTimeWithinBounds(hour, minute, second, {
    minTime: props.minTime,
    maxTime: props.maxTime,
    withSeconds: props.withSeconds,
  })
}

function confirmSingleSelection(): void {
  if (
    !isTimeWithinBounds(draftHour.value, draftMinute.value, draftSecond.value, {
      minTime: props.minTime,
      maxTime: props.maxTime,
      withSeconds: props.withSeconds,
    })
  ) {
    return
  }

  singleModel.value = formatTimeFromParts(
    draftHour.value,
    draftMinute.value,
    draftSecond.value,
    props.withSeconds,
  )
  open.value = false
}

function confirmRangeSelection(): void {
  const start = draftStartTime.value
  const end = draftEndTime.value
  const startParsed = parseTimeValue(start, props.withSeconds)
  const endParsed = parseTimeValue(end, props.withSeconds)
  if (!startParsed || !endParsed) return

  if (!isTimeRangeOrderedValues(start, end, props.withSeconds)) return
  if (
    !isTimeWithinBounds(startParsed.hour, startParsed.minute, startParsed.second, {
      minTime: props.minTime,
      maxTime: startMaxTime.value,
      withSeconds: props.withSeconds,
    }) ||
    !isTimeWithinBounds(endParsed.hour, endParsed.minute, endParsed.second, {
      minTime: endMinTime.value,
      maxTime: props.maxTime,
      withSeconds: props.withSeconds,
    })
  ) {
    return
  }

  rangeModel.value = { start, end }
  open.value = false
}

function confirmSelection(): void {
  if (props.range) {
    confirmRangeSelection()
    return
  }
  confirmSingleSelection()
}

function clearSelection(): void {
  if (props.range) {
    rangeModel.value = { ...EMPTY_TIME_RANGE }
  } else {
    singleModel.value = ''
  }
  open.value = false
}

function selectPreset(): void {
  if (props.range) {
    draftStartTime.value = formatTimeFromParts(9, 0, 0, props.withSeconds)
    draftEndTime.value = formatTimeFromParts(18, 0, 0, props.withSeconds)
    confirmRangeSelection()
    return
  }

  const current = getCurrentTime()
  draftHour.value = current.hour
  draftMinute.value = current.minute
  draftSecond.value = current.second
  confirmSingleSelection()
}

watch(open, async (isOpen) => {
  if (!isOpen) return
  syncDraftFromModel()
  if (!props.range) {
    await nextTick()
    columnsRef.value?.scrollToSelectionAfterPaint()
  }
})
</script>

<template>
  <div
    :class="[
      embedded ? 'rs-time-picker-embedded' : 'rs-field',
      !embedded && `rs-field--label-${labelPosition}`,
    ]"
  >
    <span v-if="!embedded && label" class="rs-field__label">
      <label v-if="labelPosition === 'left'" :for="fieldId">{{ label }}</label>
      <template v-else>{{ label }}</template>
      <span v-if="required" class="rs-field__required" aria-hidden="true">*</span>
    </span>

    <div class="rs-time-picker">
      <PopoverRoot v-model:open="open" :modal="!embedded">
        <PopoverTrigger
          :id="embedded ? undefined : fieldId"
          type="button"
          class="rs-time-picker__trigger"
          :class="{
            'rs-time-picker__trigger--placeholder': isEmpty,
            'rs-time-picker__trigger--embedded': embedded,
          }"
          :disabled="disabled"
        >
          <span class="rs-time-picker__leading">
            <RsIcon v-if="!embedded" name="clock" :size="16" class="rs-time-picker__icon" />
            <span class="rs-time-picker__value">{{ displayValue }}</span>
          </span>
          <RsIcon name="chevron-down" :size="16" class="rs-time-picker__chevron" />
        </PopoverTrigger>

        <PopoverPortal>
          <PopoverContent
            class="rs-time-picker__content"
            :class="{
              'rs-time-picker__content--range': range && !embedded,
              'rs-time-picker__content--embedded': embedded,
            }"
            :side-offset="6"
            align="start"
          >
            <div v-if="open" class="rs-time-picker__panel">
              <template v-if="range">
                <div class="rs-time-picker__range-grid">
                  <section class="rs-time-picker__range-pane">
                    <span class="rs-time-picker__pane-title">{{ t('timePicker.rangeStart') }}</span>
                    <RsTimePicker
                      v-model="draftStartTime"
                      embedded
                      :with-seconds="withSeconds"
                      :min-time="minTime"
                      :max-time="startMaxTime"
                      :disabled="disabled"
                    />
                  </section>

                  <section class="rs-time-picker__range-pane">
                    <span class="rs-time-picker__pane-title">{{ t('timePicker.rangeEnd') }}</span>
                    <RsTimePicker
                      v-model="draftEndTime"
                      embedded
                      :with-seconds="withSeconds"
                      :min-time="endMinTime"
                      :max-time="maxTime"
                      :disabled="disabled"
                    />
                  </section>
                </div>
              </template>

              <template v-else>
                <RsTimePickerColumns
                  ref="columnsRef"
                  v-model="draftTime"
                  :second="withSeconds"
                  :disabled="disabled"
                  :is-unit-disabled="isUnitDisabled"
                />
              </template>

              <footer class="rs-time-picker__footer">
                <button type="button" class="rs-time-picker__link" @click="selectPreset">
                  {{ range ? t('timePicker.rangePreset') : t('timePicker.now') }}
                </button>
                <div class="rs-time-picker__actions">
                  <button type="button" class="rs-time-picker__ghost" @click="clearSelection">
                    {{ range ? t('timePicker.rangeClear') : t('timePicker.clear') }}
                  </button>
                  <button
                    type="button"
                    class="rs-time-picker__confirm"
                    :disabled="range && (!draftStartTime || !draftEndTime)"
                    @click="confirmSelection"
                  >
                    {{ t('timePicker.confirm') }}
                  </button>
                </div>
              </footer>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
    </div>

    <span v-if="!embedded && hint" class="rs-field__hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.rs-time-picker {
  width: 100%;
}
.rs-time-picker-embedded {
  min-width: 0;
}
.rs-time-picker__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  width: 100%;
  min-height: var(--rs-control-height-md);
  padding: 0 var(--rs-space-md);
  border: 1px solid var(--rs-input-border, var(--rs-border));
  border-radius: var(--rs-radius-sm);
  background: var(--rs-input-bg);
  color: var(--rs-text);
  font: inherit;
  font-size: var(--rs-font-size-sm);
  text-align: left;
  cursor: pointer;
  box-shadow: var(--rs-input-shadow, none);
  transition:
    border-color var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast),
    background var(--rs-transition-fast);
}
.rs-time-picker__trigger--embedded {
  min-height: var(--rs-control-height-sm);
  min-width: 5.5rem;
  padding: 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  background: color-mix(in srgb, var(--rs-surface) 72%, transparent);
}
.rs-time-picker__trigger:hover:not(:disabled) {
  border-color: var(--rs-input-border-hover, var(--rs-border));
}
.rs-time-picker__trigger:focus-visible {
  outline: none;
  border-color: var(--rs-focus-border, var(--rs-primary));
  box-shadow:
    var(--rs-input-shadow, none),
    0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.rs-time-picker__trigger:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.rs-time-picker__trigger--placeholder .rs-time-picker__value {
  color: var(--rs-placeholder);
}
.rs-time-picker__leading {
  display: inline-flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: var(--rs-space-sm);
}
.rs-time-picker__icon,
.rs-time-picker__chevron {
  flex-shrink: 0;
  color: var(--rs-muted);
}
.rs-time-picker__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<style>
.rs-time-picker__content {
  z-index: var(--rs-z-dropdown);
  padding: 0.75rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface-elevated);
  box-shadow: var(--rs-shadow-lg);
  outline: none;
  width: min(18rem, calc(100vw - 2rem));
}
.rs-time-picker__content--range {
  width: min(28rem, calc(100vw - 2rem));
}
.rs-time-picker__content--embedded {
  z-index: calc(var(--rs-z-dropdown) + 10);
}
.rs-time-picker__panel {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}
.rs-time-picker__range-grid {
  display: grid;
  gap: 0.75rem;
}
@media (min-width: 40rem) {
  .rs-time-picker__range-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.rs-time-picker__range-pane {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--rs-space-sm);
  padding: 0.5rem;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-surface) 72%, transparent);
}
.rs-time-picker__pane-title {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-muted);
}
.rs-time-picker__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  margin-top: var(--rs-space-xs);
  padding-top: 0.75rem;
  border-top: 1px solid var(--rs-border-subtle);
}
.rs-time-picker__link {
  border: 0;
  background: transparent;
  color: var(--rs-primary);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
}
.rs-time-picker__link:hover {
  text-decoration: underline;
}
.rs-time-picker__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
}
.rs-time-picker__ghost,
.rs-time-picker__confirm {
  border: 0;
  border-radius: var(--rs-radius-sm);
  padding: 0.375rem 0.625rem;
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
}
.rs-time-picker__ghost {
  background: transparent;
  color: var(--rs-muted);
}
.rs-time-picker__ghost:hover {
  background: var(--rs-surface-hover);
  color: var(--rs-text);
}
.rs-time-picker__confirm {
  background: var(--rs-primary);
  color: var(--rs-primary-foreground);
}
.rs-time-picker__confirm:hover:not(:disabled) {
  opacity: 0.92;
}
.rs-time-picker__confirm:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
</style>
