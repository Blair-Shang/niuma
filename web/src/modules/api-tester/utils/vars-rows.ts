import type { ApiKvRow, ApiVariableKind, ApiVarRow } from '../types'
import { enabledRows } from './format'
import { normalizeVariableKind } from './variable-kind'

/** 把变量 Record 转成 KV 行；id 按 key 稳定，避免编辑器反复 remount。 */
export function recordToRows(
  record: Record<string, string>,
  idPrefix: string,
  skipKey?: (key: string) => boolean,
): ApiKvRow[] {
  const out: ApiKvRow[] = []
  for (const [key, value] of Object.entries(record)) {
    if (skipKey?.(key)) continue
    out.push({
      id: `${idPrefix}:${key}`,
      enabled: true,
      key,
      value,
    })
  }
  return out
}

/** 带 kind 的变量表 ↔ Record，供环境页写 catalog。 */
export function typedRecordToRows(
  record: Record<string, string>,
  kinds: Record<string, ApiVariableKind> | undefined,
  idPrefix: string,
  skipKey?: (key: string) => boolean,
): ApiVarRow[] {
  return recordToRows(record, idPrefix, skipKey).map((row) => ({
    ...row,
    kind: normalizeVariableKind(kinds?.[row.key]),
  }))
}

export function rowsToTypedRecord(rows: readonly ApiVarRow[]): {
  vars: Record<string, string>
  kinds: Record<string, ApiVariableKind>
} {
  const vars: Record<string, string> = {}
  const kinds: Record<string, ApiVariableKind> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!row.enabled || !key) continue
    vars[key] = row.value
    kinds[key] = normalizeVariableKind(row.kind)
  }
  return { vars, kinds }
}

/** 把 KV 行写回变量 Record（仅 enabled 且 key 非空）。 */
export function rowsToRecord(rows: readonly ApiKvRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of enabledRows([...rows])) {
    const key = row.key.trim()
    if (!key) continue
    out[key] = row.value
  }
  return out
}

/** 简单防抖，供面板写回 store 用。 */
export function debounceFn<T extends (...args: never[]) => void>(fn: T, waitMs: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, waitMs)
  }) as T
}
