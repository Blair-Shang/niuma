import { parseRsDateTimeDayjs, parseRsDayjs } from '../lib/rs-dayjs'

export interface RsDateValidationRules {
  required?: boolean
  min?: string
  max?: string
}

export type RsDateValidationError = 'required' | 'min' | 'max' | 'format'

export interface RsDateValidationResult {
  valid: boolean
  error?: RsDateValidationError
}

export type RsDateTimeValidationRules = RsDateValidationRules
export type RsDateTimeValidationError = RsDateValidationError
export type RsDateTimeValidationResult = RsDateValidationResult

export function validateDateValue(value: string, rules: RsDateValidationRules = {}): RsDateValidationResult {
  if (!value) return rules.required ? { valid: false, error: 'required' } : { valid: true }
  const parsed = parseRsDayjs(value)
  if (!parsed) return { valid: false, error: 'format' }
  const canonical = parsed.format('YYYY-MM-DD')
  if (rules.min && canonical < rules.min) return { valid: false, error: 'min' }
  if (rules.max && canonical > rules.max) return { valid: false, error: 'max' }
  return { valid: true }
}

export function validateDateTimeValue(value: string, rules: RsDateTimeValidationRules = {}): RsDateTimeValidationResult {
  if (!value) return rules.required ? { valid: false, error: 'required' } : { valid: true }
  const parsed = parseRsDateTimeDayjs(value)
  if (!parsed) return { valid: false, error: 'format' }
  const canonical = parsed.format('YYYY-MM-DD HH:mm:ss')
  if (rules.min && canonical < rules.min) return { valid: false, error: 'min' }
  if (rules.max && canonical > rules.max) return { valid: false, error: 'max' }
  return { valid: true }
}
