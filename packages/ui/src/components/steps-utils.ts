export type RsStepStatus = 'wait' | 'process' | 'finish' | 'error'
export type RsStepsOrientation = 'horizontal' | 'vertical'
export type RsStepsSize = 'sm' | 'md'

export interface RsStepItem {
  value: string
  title: string
  description?: string
  status?: RsStepStatus
  disabled?: boolean
}

export function resolveStepStatus(index: number, activeIndex: number, explicit?: RsStepStatus): RsStepStatus {
  if (explicit) return explicit
  if (index < activeIndex) return 'finish'
  if (index === activeIndex) return 'process'
  return 'wait'
}

export function isStepSeparatorCompleted(status: RsStepStatus): boolean {
  return status === 'finish'
}
