import type { ConnectionOptionsBase, ProxyOptions, ProxyType } from '@/api/types/connection'
import { DEFAULT_PROXY_OPTIONS, defaultProxyPort } from '@/api/types/connection'
import type { ProxyFormState } from '@/modules/connection/types'

export function emptyProxyFormState(): ProxyFormState {
  return {
    proxyType: 'none',
    proxyHost: '',
    proxyPort: String(defaultProxyPort('socks5')),
    proxyUsername: '',
    proxyPassword: '',
  }
}

export function applyProxyToForm(target: ProxyFormState, options?: ConnectionOptionsBase): void {
  const proxy = options?.proxy
  target.proxyType = proxy?.type ?? 'none'
  target.proxyHost = proxy?.host ?? ''
  target.proxyPort = String(
    proxy?.port ?? defaultProxyPort(target.proxyType === 'http' ? 'http' : 'socks5'),
  )
  target.proxyUsername = proxy?.username ?? ''
  target.proxyPassword = ''
}

export function syncProxyPortForType(form: ProxyFormState, type: ProxyType): void {
  if (type === 'none') {
    return
  }
  const expected = String(defaultProxyPort(type))
  const current = Number.parseInt(form.proxyPort, 10)
  if (!form.proxyPort.trim() || current === 8080 || current === 1080) {
    form.proxyPort = expected
  }
}

export function buildProxyOptions(form: ProxyFormState, savedPassword?: string): ProxyOptions {
  if (form.proxyType === 'none') {
    return { ...DEFAULT_PROXY_OPTIONS }
  }
  const password =
    form.proxyPassword.trim() || (typeof savedPassword === 'string' ? savedPassword : '')
  return {
    type: form.proxyType,
    host: form.proxyHost.trim(),
    port: Number.parseInt(form.proxyPort, 10) || defaultProxyPort(form.proxyType),
    username: form.proxyUsername.trim(),
    password,
  }
}

export function validateProxyForm(form: ProxyFormState): boolean {
  if (form.proxyType === 'none') {
    return true
  }
  return Boolean(form.proxyHost.trim())
}
