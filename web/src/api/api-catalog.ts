import { bridgeInvoke } from '@/api/client'
import type {
  ApiEnvironmentCreateParams,
  ApiEnvironmentCreateResult,
  ApiEnvironmentDeleteParams,
  ApiEnvironmentDeleteResult,
  ApiEnvironmentListParams,
  ApiEnvironmentListResult,
  ApiEnvironmentUpdateParams,
  ApiEnvironmentUpdateResult,
  ApiVariableDeleteParams,
  ApiVariableDeleteResult,
  ApiVariableListParams,
  ApiVariableListResult,
  ApiVariableReplaceScopeParams,
  ApiVariableReplaceScopeResult,
  ApiVariableUpsertParams,
  ApiVariableUpsertResult,
} from '@/api/types/api-catalog'

/**
 * API 环境与变量（Platform `nm_api_environment` / `nm_api_variable`）。
 * 集合树仍在 `api.workspace` v3 JSON；变量不再写入 Postman 式环境块。
 */
export const apiCatalogApi = {
  listEnvironments(params?: ApiEnvironmentListParams): Promise<ApiEnvironmentListResult> {
    return bridgeInvoke<ApiEnvironmentListResult>('platform.api.environment.list', params ?? {})
  },

  createEnvironment(params: ApiEnvironmentCreateParams): Promise<ApiEnvironmentCreateResult> {
    return bridgeInvoke<ApiEnvironmentCreateResult>('platform.api.environment.create', params)
  },

  updateEnvironment(params: ApiEnvironmentUpdateParams): Promise<ApiEnvironmentUpdateResult> {
    return bridgeInvoke<ApiEnvironmentUpdateResult>('platform.api.environment.update', params)
  },

  deleteEnvironment(params: ApiEnvironmentDeleteParams): Promise<ApiEnvironmentDeleteResult> {
    return bridgeInvoke<ApiEnvironmentDeleteResult>('platform.api.environment.delete', params)
  },

  listVariables(params?: ApiVariableListParams): Promise<ApiVariableListResult> {
    return bridgeInvoke<ApiVariableListResult>('platform.api.variable.list', params ?? {})
  },

  upsertVariable(params: ApiVariableUpsertParams): Promise<ApiVariableUpsertResult> {
    return bridgeInvoke<ApiVariableUpsertResult>('platform.api.variable.upsert', params)
  },

  deleteVariable(params: ApiVariableDeleteParams): Promise<ApiVariableDeleteResult> {
    return bridgeInvoke<ApiVariableDeleteResult>('platform.api.variable.delete', params)
  },

  replaceScope(params: ApiVariableReplaceScopeParams): Promise<ApiVariableReplaceScopeResult> {
    return bridgeInvoke<ApiVariableReplaceScopeResult>('platform.api.variable.replaceScope', params)
  },
} as const
