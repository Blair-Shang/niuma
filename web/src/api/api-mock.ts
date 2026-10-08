import { bridgeInvoke } from '@/api/client'
import type {
  ApiMockHit,
  ApiMockServerParams,
  ApiMockStartParams,
  ApiMockStartResult,
} from '@/api/types/api-mock'

/** 本机 Mock（platform-core 代理至 api-service）。 */
export const apiMockApi = {
  start(params: ApiMockStartParams): Promise<ApiMockStartResult> {
    return bridgeInvoke<ApiMockStartResult>('api.mock.start', params)
  },

  stop(params: ApiMockServerParams): Promise<{ stopped: boolean }> {
    return bridgeInvoke<{ stopped: boolean }>('api.mock.stop', params)
  },

  update(params: ApiMockServerParams): Promise<{ updated: boolean }> {
    return bridgeInvoke<{ updated: boolean }>('api.mock.update', params)
  },

  log(params: ApiMockServerParams): Promise<{ hits: ApiMockHit[] }> {
    return bridgeInvoke<{ hits: ApiMockHit[] }>('api.mock.log', params)
  },
} as const
