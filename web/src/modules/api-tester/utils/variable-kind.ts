/**
 * 环境 / 全局变量类型。插值仍用字符串值；kind 写入 nm_api_variable 供后端分支处理。
 */
import type { ApiVariableKind } from '@/api/types/api-catalog'

export const API_VARIABLE_KINDS = [
  'string',
  'secret',
  'number',
  'boolean',
  'json',
  'uuid',
  'counter',
  'datetime',
  'file_ref',
] as const satisfies readonly ApiVariableKind[]

const KIND_SET = new Set<string>(API_VARIABLE_KINDS)

/** 非法或空 kind 回落为 string，与 Platform normalizeVariableKind 对齐。 */
export function normalizeVariableKind(kind: string | undefined): ApiVariableKind {
  if (kind && KIND_SET.has(kind)) return kind as ApiVariableKind
  return 'string'
}

export function variableKindLabelKey(kind: ApiVariableKind): string {
  return `modules.api.varKind.${kind}`
}

/** 切换类型时的缺省值，保证后端能按 kind 解析。 */
export function defaultValueForKind(kind: ApiVariableKind): string {
  switch (kind) {
    case 'number':
    case 'counter':
      return '0'
    case 'boolean':
      return 'true'
    case 'json':
      return '{}'
    case 'datetime':
      return '2006-01-02T15:04:05Z'
    case 'uuid':
      return crypto.randomUUID()
    default:
      return ''
  }
}

export function valuePlaceholderKey(kind: ApiVariableKind): string {
  return `modules.api.varKindPlaceholder.${kind}`
}
