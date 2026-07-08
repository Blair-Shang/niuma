<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  RsFormFieldExpose,
  RsFormGap,
  RsFormLabelAlign,
  RsFormLabelPosition,
  RsFormMaxWidth,
  RsFormSize,
  RsFormValidationResult,
} from './form-utils'
import { cloneFormFieldValue, provideRsFormContext } from './form-utils'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    labelPosition?: RsFormLabelPosition
    labelWidth?: string
    labelAlign?: RsFormLabelAlign
    size?: RsFormSize
    gap?: RsFormGap
    maxWidth?: RsFormMaxWidth
  }>(),
  {
    disabled: false,
    labelPosition: 'top',
    labelWidth: '6rem',
    labelAlign: 'start',
    size: 'md',
    gap: 'md',
    maxWidth: 'full',
  },
)

const fields = new Map<symbol, RsFormFieldExpose>()
const disabledRef = computed(() => props.disabled)
const labelPositionRef = computed(() => props.labelPosition)
const labelWidthRef = computed(() => props.labelWidth)
const labelAlignRef = computed(() => props.labelAlign)
const sizeRef = computed(() => props.size)
const initialValues = ref(new Map<symbol, unknown>())

function registerField(id: symbol, field: RsFormFieldExpose): void {
  fields.set(id, field)
  initialValues.value.set(id, cloneFormFieldValue(field.getValue()))
}

function unregisterField(id: symbol): void {
  fields.delete(id)
  initialValues.value.delete(id)
}

provideRsFormContext({
  disabled: disabledRef,
  labelPosition: labelPositionRef,
  labelWidth: labelWidthRef,
  labelAlign: labelAlignRef,
  size: sizeRef,
  registerField,
  unregisterField,
})

async function validate(): Promise<RsFormValidationResult> {
  const results = await Promise.all(
    Array.from(fields.values()).map((field) => field.validate?.() ?? { valid: true }),
  )
  return { valid: results.every((result) => result.valid) }
}

function clearValidation(): void {
  fields.forEach((field) => field.clearValidation?.())
}

function resetFields(): void {
  fields.forEach((field, id) => {
    field.setValue(cloneFormFieldValue(initialValues.value.get(id)))
    field.clearValidation?.()
  })
}

defineExpose({
  validate,
  clearValidation,
  resetFields,
})
</script>

<template>
  <form
    class="rs-form"
    :class="[
      `rs-form--gap-${gap}`,
      `rs-form--max-${maxWidth}`,
      `rs-form--label-${labelPosition}`,
    ]"
  >
    <slot />
  </form>
</template>

<style scoped>
.rs-form {
  display: flex;
  flex-direction: column;
  width: 100%;
}
.rs-form--gap-sm {
  gap: var(--rs-space-sm);
}
.rs-form--gap-md {
  gap: var(--rs-space-md);
}
.rs-form--gap-lg {
  gap: var(--rs-space-lg);
}
.rs-form--max-sm {
  max-width: 24rem;
}
.rs-form--max-md {
  max-width: 32rem;
}
.rs-form--max-lg {
  max-width: 48rem;
}
.rs-form--max-full {
  max-width: 100%;
}
.rs-form--max-none {
  max-width: none;
}
</style>
