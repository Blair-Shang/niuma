/**
 * Platform catalog 行与运行时 ApiEnvironment / folder.vars 的转换。
 * 只做映射，不发 IPC；排队落盘在 catalog-persist。
 */
import type { ApiCatalogEnvironment, ApiCatalogVariable, ApiVariableInput, ApiVariableKind } from '@/api/types/api-catalog'
import type { ApiEnvironment, ApiFolder } from '../types'
import { emptyKinds, emptyVars } from './collection-io'
import { normalizeVariableKind } from './variable-kind'

export interface TypedVarRecord {
  vars: Record<string, string>
  kinds: Record<string, ApiVariableKind>
}

/** KV 记录转为 Platform 变量输入（跳过 baseUrl 等结构化字段）。 */
export function recordToVariableInputs(
  record: Record<string, string>,
  kinds: Record<string, ApiVariableKind> = {},
  skipKeys: readonly string[] = ['baseUrl'],
): ApiVariableInput[] {
  const inputs: ApiVariableInput[] = []
  let order = 0
  for (const [key, value] of Object.entries(record)) {
    if (skipKeys.includes(key)) continue
    inputs.push({
      variableName: key,
      variableKind: normalizeVariableKind(kinds[key]),
      initialValue: value,
      currentValue: value,
      sortOrder: order,
    })
    order += 1
  }
  return inputs
}

/** 把 catalog 变量行拆成插值 Map + kind Map。 */
export function catalogToTypedRecord(
  items: readonly ApiCatalogVariable[],
  scope: ApiCatalogVariable['variableScope'],
  scopeRefId = '',
): TypedVarRecord {
  const vars = emptyVars()
  const kinds = emptyKinds()
  for (const item of items) {
    if (item.variableScope !== scope) continue
    if (scope !== 'global' && item.scopeRefId !== scopeRefId) continue
    vars[item.variableName] = item.currentValue || item.initialValue
    kinds[item.variableName] = normalizeVariableKind(item.variableKind)
  }
  return { vars, kinds }
}

/** Platform 环境行 + 变量包 → 运行时 ApiEnvironment。 */
export function catalogEnvironmentToRuntime(
  env: ApiCatalogEnvironment,
  typed: TypedVarRecord = { vars: emptyVars(), kinds: emptyKinds() },
): ApiEnvironment {
  const runtimeVars = { ...typed.vars }
  if (env.baseUrl.trim()) runtimeVars.baseUrl = env.baseUrl.trim()
  return {
    id: env.environmentId,
    name: env.environmentName,
    baseUrl: env.baseUrl,
    vars: runtimeVars,
    kinds: { ...typed.kinds },
  }
}

/** 将 folder scope 变量挂回集合树（内存态，供 resolve 使用）。 */
export function applyFolderVariables(folders: readonly ApiFolder[], variables: readonly ApiCatalogVariable[]): void {
  for (const folder of folders) {
    folder.vars = emptyVars()
    folder.kinds = emptyKinds()
  }
  for (const item of variables) {
    if (item.variableScope !== 'folder') continue
    const folder = folders.find((row) => row.id === item.scopeRefId)
    if (!folder) continue
    folder.vars[item.variableName] = item.currentValue || item.initialValue
    folder.kinds = folder.kinds ?? emptyKinds()
    folder.kinds[item.variableName] = normalizeVariableKind(item.variableKind)
  }
}
