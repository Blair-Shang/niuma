import type { RsTimeRangeValue } from './time-picker-utils'
import { isTimeRangeOrdered } from './time-picker-utils'

export interface RsTimeRangeValidationRules {
  required?: boolean
  ordered?: boolean
}

export type RsTimeRangeValidationError = 'required' | 'order'

export interface RsTimeRangeValidationResult {
  valid: boolean
  error?: RsTimeRangeValidationError
}

export function validateTimeRangeValue(
  value: RsTimeRangeValue,
  rules: RsTimeRangeValidationRules = {},
): RsTimeRangeValidationResult {
  if (rules.required && (!value.start || !value.end)) return { valid: false, error: 'required' }
  if (rules.ordered !== false && !isTimeRangeOrdered(value)) return { valid: false, error: 'order' }
  return { valid: true }
}
