import { bridgeInvoke } from '@/api/client'
import type {
  ApiHistoryAppendParams,
  ApiHistoryAppendResult,
  ApiHistoryClearParams,
  ApiHistoryClearResult,
  ApiHistoryDeleteParams,
  ApiHistoryDeleteResult,
  ApiHistoryGetParams,
  ApiHistoryGetResult,
  ApiHistoryListParams,
  ApiHistoryListResult,
} from '@/api/types/api'

/**
 * API 发送历史（Platform `nm_api_history`）。
 * 集合导入导出不走这些方法。
 */
export const apiHistoryApi = {
  list(params?: ApiHistoryListParams): Promise<ApiHistoryListResult> {
    return bridgeInvoke<ApiHistoryListResult>('platform.api.history.list', params ?? {})
  },

  get(params: ApiHistoryGetParams): Promise<ApiHistoryGetResult> {
    return bridgeInvoke<ApiHistoryGetResult>('platform.api.history.get', params)
  },

  append(params: ApiHistoryAppendParams): Promise<ApiHistoryAppendResult> {
    return bridgeInvoke<ApiHistoryAppendResult>('platform.api.history.append', params)
  },

  delete(params: ApiHistoryDeleteParams): Promise<ApiHistoryDeleteResult> {
    return bridgeInvoke<ApiHistoryDeleteResult>('platform.api.history.delete', params)
  },

  clear(params?: ApiHistoryClearParams): Promise<ApiHistoryClearResult> {
    return bridgeInvoke<ApiHistoryClearResult>('platform.api.history.clear', params ?? {})
  },
} as const
