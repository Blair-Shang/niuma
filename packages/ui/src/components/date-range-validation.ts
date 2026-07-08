import type { RsDateRangeValue } from './date-picker-utils'
import { isDateRangeOrdered } from './date-picker-utils'

export interface RsDateRangeValidationRules {
  required?: boolean
  ordered?: boolean
}

export type RsDateRangeValidationError = 'required' | 'order'

export interface RsDateRangeValidationResult {
  valid: boolean
  error?: RsDateRangeValidationError
}

export type RsDateTimeRangeValidationRules = RsDateRangeValidationRules
export type RsDateTimeRangeValidationError = RsDateRangeValidationError
export type RsDateTimeRangeValidationResult = RsDateRangeValidationResult

export function validateDateRangeValue(
  value: RsDateRangeValue,
  rules: RsDateRangeValidationRules = {},
): RsDateRangeValidationResult {
  if (rules.required && (!value.start || !value.end)) return { valid: false, error: 'required' }
  if (rules.ordered !== false && !isDateRangeOrdered(value)) return { valid: false, error: 'order' }
  return { valid: true }
}

export const validateDateTimeRangeValue = validateDateRangeValue
