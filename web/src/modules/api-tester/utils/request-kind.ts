/** TCP/UDP 地址栏拆合。协议切换默认值在 apiPaneRegistry / panes/*。 */
import { isListenHost, parseTarget } from './target'

export const DEFAULT_SOCKET_URL = '127.0.0.1:9000'
export const DEFAULT_LISTEN_URL = '0.0.0.0:9000'

export function looksLikeHttpUrl(url: string): boolean {
  const text = url.trim().toLowerCase()
  if (!text) return false
  if (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('{{')) return true
  return text.includes('/')
}

export function splitSocketUrl(url: string): { host: string; port: string; listen: boolean } {
  try {
    const target = parseTarget(url.trim() || DEFAULT_SOCKET_URL, 'TCP')
    return { host: target.host, port: String(target.port), listen: target.listen }
  } catch {
    return { host: '', port: '', listen: false }
  }
}

export function joinSocketUrl(host: string, port: string, listen: boolean): string {
  const trimmed = host.trim() || (listen ? '0.0.0.0' : '127.0.0.1')
  const portText = port.trim()
  const wrapped = trimmed.includes(':') && !trimmed.startsWith('[') ? `[${trimmed}]` : trimmed
  const hostPort = portText ? `${wrapped}:${portText}` : wrapped
  if (listen && !isListenHost(trimmed)) return `listen://${hostPort}`
  return hostPort
}
