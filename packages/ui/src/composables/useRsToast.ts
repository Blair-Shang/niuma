import { toast } from 'vue-sonner'
import type { RsToastPosition, RsToastType } from '../components/overlay-utils'

export type { RsToastPosition, RsToastType }

export type RsToastInput =
  | string
  | {
      title: string
      description?: string
      position?: RsToastPosition
      duration?: number
    }

function resolveToast(input: RsToastInput): {
  title: string
  description?: string
  position?: RsToastPosition
  duration?: number
} {
  if (typeof input === 'string') return { title: input }
  return input
}

export function useRsToast() {
  function show(type: RsToastType, input: RsToastInput): void {
    const payload = resolveToast(input)
    const options = {
      description: payload.description,
      ...(payload.position ? { position: payload.position } : {}),
      ...(payload.duration ? { duration: payload.duration } : {}),
      class: `rs-toast rs-toast--${type}`,
    }

    if (type === 'success') toast.success(payload.title, options)
    else if (type === 'error') toast.error(payload.title, options)
    else if (type === 'warning') toast.warning(payload.title, options)
    else toast.info(payload.title, options)
  }

  return {
    success: (input: RsToastInput) => show('success', input),
    error: (input: RsToastInput) => show('error', input),
    info: (input: RsToastInput) => show('info', input),
    warning: (input: RsToastInput) => show('warning', input),
    dismiss: toast.dismiss,
  }
}
