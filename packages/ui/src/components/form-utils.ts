import {
  computed,
  inject,
  onMounted,
  onUnmounted,
  provide,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue'

export type RsFormLabelPosition = 'top' | 'left'
export type RsFormLabelAlign = 'start' | 'end'
export type RsFormSize = 'sm' | 'md' | 'lg'
export type RsFormGap = 'sm' | 'md' | 'lg'
export type RsFormMaxWidth = 'sm' | 'md' | 'lg' | 'full' | 'none'

export interface RsFormValidationResult {
  valid: boolean
}

export interface RsFormFieldExpose {
  getValue: () => unknown
  setValue: (value: unknown) => void
  validate?: () => RsFormValidationResult | Promise<RsFormValidationResult>
  clearValidation?: () => void
}

export interface RsFormContext {
  disabled: Readonly<Ref<boolean>>
  labelPosition: ComputedRef<RsFormLabelPosition>
  labelWidth: Readonly<Ref<string>>
  labelAlign: Readonly<Ref<RsFormLabelAlign>>
  size: Readonly<Ref<RsFormSize>>
  registerField: (id: symbol, field: RsFormFieldExpose) => void
  unregisterField: (id: symbol) => void
}

export const RS_FORM_INJECTION_KEY: InjectionKey<RsFormContext> = Symbol('RsForm')

export function cloneFormFieldValue(value: unknown): unknown {
  if (value === undefined || value === null) return value
  if (typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

export function provideRsFormContext(context: RsFormContext): void {
  provide(RS_FORM_INJECTION_KEY, context)
}

export function useRsFormContext(): RsFormContext | null {
  return inject(RS_FORM_INJECTION_KEY, null)
}

export function useRsFormField(getExpose: () => RsFormFieldExpose | undefined): void {
  const form = useRsFormContext()
  if (!form) return

  const fieldId = Symbol('rs-form-field')

  onMounted(() => {
    const expose = getExpose()
    if (expose) form.registerField(fieldId, expose)
  })

  onUnmounted(() => {
    form.unregisterField(fieldId)
  })
}

export function resolveRsFormSize(size?: RsFormSize, form?: RsFormContext | null): ComputedRef<RsFormSize> {
  return computed(() => size ?? form?.size.value ?? 'md')
}
