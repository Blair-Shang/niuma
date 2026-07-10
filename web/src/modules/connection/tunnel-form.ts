import type { ConnectionOptionsBase, TunnelOptions } from '@/api/types/connection'
import { DEFAULT_TUNNEL_OPTIONS } from '@/api/types/connection'
import type { TunnelFormState } from '@/modules/connection/types'

export function emptyTunnelFormState(): TunnelFormState {
  return {
    tunnelType: 'none',
    tunnelSshProfileId: '',
    tunnelTargetHost: '',
    tunnelTargetPort: '',
  }
}

export function applyTunnelToForm(target: TunnelFormState, options?: ConnectionOptionsBase): void {
  const tunnel = options?.tunnel
  target.tunnelType = tunnel?.type ?? 'none'
  target.tunnelSshProfileId = tunnel?.sshProfileId ?? ''
  target.tunnelTargetHost = tunnel?.targetHost ?? ''
  target.tunnelTargetPort = tunnel?.targetPort ? String(tunnel.targetPort) : ''
}

export function buildTunnelOptions(form: TunnelFormState): TunnelOptions {
  if (form.tunnelType === 'none') {
    return { ...DEFAULT_TUNNEL_OPTIONS }
  }
  return {
    type: form.tunnelType,
    sshProfileId: form.tunnelSshProfileId.trim(),
    targetHost: form.tunnelTargetHost.trim(),
    targetPort: Number.parseInt(form.tunnelTargetPort, 10) || 0,
  }
}

export function validateTunnelForm(form: TunnelFormState): boolean {
  if (form.tunnelType === 'none') {
    return true
  }
  return Boolean(form.tunnelSshProfileId.trim())
}
