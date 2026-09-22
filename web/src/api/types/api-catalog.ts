/** API 环境与变量 — 对应 Platform `nm_api_environment` / `nm_api_variable`。 */

export type ApiVariableScope = 'global' | 'environment' | 'folder'

export type ApiVariableKind =
  | 'string'
  | 'secret'
  | 'number'
  | 'boolean'
  | 'json'
  | 'uuid'
  | 'counter'
  | 'datetime'
  | 'file_ref'

export interface ApiCatalogEnvironment {
  environmentId: string
  workspaceId: string
  environmentName: string
  baseUrl: string
  createdAt: string
  updatedAt: string
}

export interface ApiCatalogVariable {
  variableId: string
  workspaceId: string
  variableScope: ApiVariableScope
  scopeRefId: string
  variableName: string
  variableKind: ApiVariableKind
  initialValue: string
  currentValue: string
  metaJson?: unknown
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ApiVariableInput {
  variableId?: string
  variableName: string
  variableKind?: ApiVariableKind
  initialValue?: string
  currentValue?: string
  metaJson?: unknown
  sortOrder?: number
}

export interface ApiEnvironmentListParams {
  workspaceId?: string
}

export interface ApiEnvironmentListResult {
  environments: ApiCatalogEnvironment[]
}

export interface ApiEnvironmentCreateParams {
  workspaceId?: string
  environmentId?: string
  environmentName: string
  baseUrl?: string
}

export interface ApiEnvironmentCreateResult {
  environment: ApiCatalogEnvironment
}

export interface ApiEnvironmentUpdateParams {
  environmentId: string
  environmentName: string
  baseUrl?: string
}

export interface ApiEnvironmentUpdateResult {
  environment: ApiCatalogEnvironment
}

export interface ApiEnvironmentDeleteParams {
  environmentId: string
}

export interface ApiEnvironmentDeleteResult {
  deleted: boolean
}

export interface ApiVariableListParams {
  workspaceId?: string
  variableScope?: ApiVariableScope
  scopeRefId?: string
}

export interface ApiVariableListResult {
  variables: ApiCatalogVariable[]
}

export interface ApiVariableUpsertParams {
  workspaceId?: string
  variableId?: string
  variableScope: ApiVariableScope
  scopeRefId?: string
  variableName: string
  variableKind?: ApiVariableKind
  initialValue?: string
  currentValue?: string
  metaJson?: unknown
  sortOrder?: number
}

export interface ApiVariableUpsertResult {
  variable: ApiCatalogVariable
}

export interface ApiVariableDeleteParams {
  variableId: string
}

export interface ApiVariableDeleteResult {
  deleted: boolean
}

export interface ApiVariableReplaceScopeParams {
  workspaceId?: string
  variableScope: ApiVariableScope
  scopeRefId?: string
  variables: ApiVariableInput[]
}

export interface ApiVariableReplaceScopeResult {
  variables: ApiCatalogVariable[]
}
