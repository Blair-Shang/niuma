export interface RsTimeValidationRules {
  required?: boolean
  min?: string
  max?: string
}

export type RsTimeValidationError = 'required' | 'min' | 'max' | 'format'

export interface RsTimeValidationResult {
  valid: boolean
  error?: RsTimeValidationError
}

export function validateTimeValue(value: string, rules: RsTimeValidationRules = {}): RsTimeValidationResult {
  if (!value) return rules.required ? { valid: false, error: 'required' } : { valid: true }
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(value)) return { valid: false, error: 'format' }
  if (rules.min && value < rules.min) return { valid: false, error: 'min' }
  if (rules.max && value > rules.max) return { valid: false, error: 'max' }
  return { valid: true }
}
