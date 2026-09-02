import { bridgeInvoke } from '@/api/client'
import { subscribeBridgeEventByPrefix } from '@/api/event-bus'
import type {
  ApiSocketCloseParams,
  ApiSocketCloseResult,
  ApiSocketKickParams,
  ApiSocketKickResult,
  ApiSocketListResult,
  ApiSocketOpenParams,
  ApiSocketPeersParams,
  ApiSocketPeersResult,
  ApiSocketSendParams,
  ApiSocketSendResult,
  ApiSocketSessionInfo,
  ApiSocketTestResult,
} from '@/api/types/api-socket'

/**
 * API 工作台原始套接字（platform-core 代理至 api-service）。
 */
export const apiSocketApi = {
  open(params: ApiSocketOpenParams): Promise<ApiSocketSessionInfo> {
    return bridgeInvoke<ApiSocketSessionInfo>('api.session.open', params)
  },

  close(params: ApiSocketCloseParams): Promise<ApiSocketCloseResult> {
    return bridgeInvoke<ApiSocketCloseResult>('api.session.close', params)
  },

  test(params: ApiSocketOpenParams): Promise<ApiSocketTestResult> {
    return bridgeInvoke<ApiSocketTestResult>('api.session.test', params)
  },

  send(params: ApiSocketSendParams): Promise<ApiSocketSendResult> {
    return bridgeInvoke<ApiSocketSendResult>('api.socket.send', params)
  },

  list(): Promise<ApiSocketListResult> {
    return bridgeInvoke<ApiSocketListResult>('api.socket.list', {})
  },

  peers(params: ApiSocketPeersParams): Promise<ApiSocketPeersResult> {
    return bridgeInvoke<ApiSocketPeersResult>('api.socket.peers', params)
  },

  kick(params: ApiSocketKickParams): Promise<ApiSocketKickResult> {
    return bridgeInvoke<ApiSocketKickResult>('api.socket.kick', params)
  },

  onEvent(handler: (detail: unknown) => void): () => void {
    return subscribeBridgeEventByPrefix('api.', handler)
  },
} as const
