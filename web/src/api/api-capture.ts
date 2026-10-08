import { bridgeInvoke } from '@/api/client'

export interface ApiCaptureEntry {
  id: string
  method: string
  url: string
  headers: { name: string; value: string }[]
  body: string
  at: string
}

/** 本机 HTTP 代理。只监听 127.0.0.1，HTTPS 只记录目标主机。 */
export const apiCaptureApi = {
  start(params: { host?: string; port?: number }): Promise<{ listenAddr: string; port: number }> {
    return bridgeInvoke('api.proxy.start', params)
  },
  stop(): Promise<{ stopped: boolean }> {
    return bridgeInvoke('api.proxy.stop', {})
  },
  log(): Promise<{ entries: ApiCaptureEntry[] }> {
    return bridgeInvoke('api.proxy.log', {})
  },
} as const
