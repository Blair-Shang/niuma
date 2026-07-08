<script setup lang="ts">
import RsDatePicker from './RsDatePicker.vue'
import type { RsDateRangeValue } from './date-picker-utils'

export type RsDateTimeRangeValue = RsDateRangeValue
export type RsDateTimePickerLabelPosition = 'top' | 'left'

const model = defineModel<string | RsDateTimeRangeValue>({ default: '' })
const open = defineModel<boolean>('open', { default: false })

withDefaults(
  defineProps<{
    label?: string
    hint?: string
    placeholder?: string
    disabled?: boolean
    required?: boolean
    range?: boolean
    withSeconds?: boolean
    minDate?: string
    maxDate?: string
    labelPosition?: RsDateTimePickerLabelPosition
  }>(),
  {
    disabled: false,
    required: false,
    range: false,
    withSeconds: false,
    labelPosition: 'top',
  },
)
</script>

<template>
  <RsDatePicker
    v-bind="$props"
    v-model="model"
    v-model:open="open"
    with-time
    :with-seconds="withSeconds"
  />
</template>
