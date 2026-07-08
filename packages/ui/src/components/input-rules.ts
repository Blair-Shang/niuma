import type { RsTranslateFn } from '../composables/useRsI18n'
import { createTranslator } from '../composables/useRsI18n'
import { defaultLocale } from '../locale/types'

export type RsInputRule = 'email' | 'number' | 'integer' | 'phone' | 'url' | 'minComplexity'

export type RsInputValidateTrigger = 'blur' | 'input' | 'both'

export const inputRuleMessageKeys: Record<RsInputRule, string> = {
  email: 'input.rule.email',
  number: 'input.rule.number',
  integer: 'input.rule.integer',
  phone: 'input.rule.phone',
  url: 'input.rule.url',
  minComplexity: 'input.rule.minComplexity',
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const numberPattern = /^-?\d+(\.\d+)?$/
const integerPattern = /^-?\d+$/
const phonePattern = /^1[3-9]\d{9}$/
const urlPattern = /^https?:\/\/.+/i
const minComplexityPattern = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

export function validateInputRule(value: string, rule: RsInputRule): boolean {
  if (value === '') return true

  switch (rule) {
    case 'email':
      return emailPattern.test(value)
    case 'number':
      return numberPattern.test(value)
    case 'integer':
      return integerPattern.test(value)
    case 'phone':
      return phonePattern.test(value)
    case 'url':
      return urlPattern.test(value)
    case 'minComplexity':
      return minComplexityPattern.test(value)
    default:
      return true
  }
}

export function getInputRuleMessage(rule: RsInputRule, t?: RsTranslateFn): string {
  const key = inputRuleMessageKeys[rule]
  const tr = t ?? createTranslator(defaultLocale)
  return tr(key)
}

export interface RsInputValidateResult {
  valid: boolean
  message?: string
}

export function runInputValidation(
  value: string,
  options: {
    rule?: RsInputRule
    required?: boolean
    validator?: (value: string) => boolean | string
  },
  t?: RsTranslateFn,
): RsInputValidateResult {
  const tr = t ?? createTranslator(defaultLocale)

  if (options.required && value.trim() === '') {
    return { valid: false, message: tr('input.required') }
  }

  if (options.rule && !validateInputRule(value, options.rule)) {
    return { valid: false, message: getInputRuleMessage(options.rule, tr) }
  }

  if (options.validator) {
    const result = options.validator(value)
    if (result === true) return { valid: true }
    if (result === false) return { valid: false, message: tr('input.formatInvalid') }
    if (typeof result === 'string') return { valid: false, message: result }
  }

  return { valid: true }
}
