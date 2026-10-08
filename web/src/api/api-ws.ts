import { bridgeInvoke } from '@/api/client'
import type {
  ApiWsCloseParams,
  ApiWsCloseResult,
  ApiWsConnectParams,
  ApiWsSendParams,
  ApiWsSendResult,
  ApiWsSessionInfo,
} from '@/api/types/api-ws'

/** WebSocket 客户端（platform-core 代理至 api-service）。 */
export const apiWsApi = {
  connect(params: ApiWsConnectParams): Promise<ApiWsSessionInfo> {
    return bridgeInvoke<ApiWsSessionInfo>('api.ws.connect', params)
  },

  send(params: ApiWsSendParams): Promise<ApiWsSendResult> {
    return bridgeInvoke<ApiWsSendResult>('api.ws.send', params)
  },

  close(params: ApiWsCloseParams): Promise<ApiWsCloseResult> {
    return bridgeInvoke<ApiWsCloseResult>('api.ws.close', params)
  },
} as const
