import { bridgeInvoke } from '@/api/client'
import type {
  ApiHttpCancelParams,
  ApiHttpCancelResult,
  ApiHttpExchangeParams,
  ApiHttpExchangeResult,
} from '@/api/types/api-http'

/** HTTP / HTTPS 发送（platform-core 代理至 api-service）。 */
export const apiHttpApi = {
  exchange(params: ApiHttpExchangeParams): Promise<ApiHttpExchangeResult> {
    return bridgeInvoke<ApiHttpExchangeResult>('api.http.exchange', params)
  },

  cancel(params: ApiHttpCancelParams): Promise<ApiHttpCancelResult> {
    return bridgeInvoke<ApiHttpCancelResult>('api.http.cancel', params)
  },
} as const
