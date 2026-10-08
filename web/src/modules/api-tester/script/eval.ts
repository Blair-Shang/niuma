import { createId } from '@/utils/id'
import type { ApiCheck, ApiCheckKind, ApiCheckResult, ApiExchange, ApiPreStep } from '../types'

export interface ApiVarWrite {
  scope: 'global' | 'environment'
  key: string
  value: string
}

const CHECK_KINDS: readonly ApiCheckKind[] = ['status', 'bodyContains', 'header', 'jsonEquals', 'timeUnder']

/** 按顺序插值并生成变量写入。后一步能看见前一步的值。 */
export function resolvePreSteps(
  steps: readonly ApiPreStep[] | undefined,
  values: Record<string, string>,
  interpolate: (text: string, values: Record<string, string>) => string,
): ApiVarWrite[] {
  const next = { ...values }
  const writes: ApiVarWrite[] = []
  for (const step of steps ?? []) {
    if (!step.enabled) continue
    const key = step.key.trim()
    if (!key) continue
    const value = interpolate(step.value, next)
    next[key] = value
    writes.push({
      scope: step.scope === 'global' ? 'global' : 'environment',
      key,
      value,
    })
  }
  return writes
}

/** 对一次交换跑已启用的断言。 */
export function evaluateChecks(
  checks: readonly ApiCheck[] | undefined,
  exchange: Pick<ApiExchange, 'status' | 'body' | 'headers' | 'durationMs'>,
): ApiCheckResult[] {
  const out: ApiCheckResult[] = []
  for (const check of checks ?? []) {
    if (!check.enabled) continue
    out.push(evaluateCheck(check, exchange))
  }
  return out
}

/** 有失败断言时把交换标成不通过。 */
export function attachChecks(exchange: ApiExchange, checks: ApiCheckResult[]): void {
  if (!checks.length) return
  exchange.checks = checks
  if (checks.some((item) => !item.ok)) exchange.ok = false
}

export function asPreSteps(raw: unknown): ApiPreStep[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const item = row as Record<string, unknown>
    const id = typeof item.id === 'string' && item.id.trim() ? item.id : createId('pre')
    return [{
      id,
      enabled: item.enabled !== false,
      scope: item.scope === 'global' ? 'global' as const : 'environment' as const,
      key: typeof item.key === 'string' ? item.key : '',
      value: typeof item.value === 'string' ? item.value : '',
    }]
  })
}

export function asChecks(raw: unknown): ApiCheck[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const item = row as Record<string, unknown>
    const kind = CHECK_KINDS.includes(item.kind as ApiCheckKind) ? (item.kind as ApiCheckKind) : 'status'
    const id = typeof item.id === 'string' && item.id.trim() ? item.id : createId('chk')
    return [{
      id,
      enabled: item.enabled !== false,
      kind,
      target: typeof item.target === 'string' ? item.target : '',
      expect: typeof item.expect === 'string' ? item.expect : '',
    }]
  })
}

export function asCheckResults(raw: unknown): ApiCheckResult[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const rows = raw.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const item = row as Record<string, unknown>
    if (!CHECK_KINDS.includes(item.kind as ApiCheckKind)) return []
    return [{
      ok: item.ok === true,
      kind: item.kind as ApiCheckKind,
      detail: typeof item.detail === 'string' ? item.detail : '',
    }]
  })
  return rows.length ? rows : undefined
}

function evaluateCheck(
  check: ApiCheck,
  exchange: Pick<ApiExchange, 'status' | 'body' | 'headers' | 'durationMs'>,
): ApiCheckResult {
  if (check.kind === 'status') {
    const want = Number(check.expect)
    return { ok: exchange.status === want, kind: check.kind, detail: `${exchange.status ?? '-'} / ${check.expect}` }
  }
  if (check.kind === 'bodyContains') {
    return { ok: exchange.body.includes(check.expect), kind: check.kind, detail: check.expect }
  }
  if (check.kind === 'header') {
    const name = check.target.trim().toLowerCase()
    const row = exchange.headers.find((item) => item.key.toLowerCase() === name)
    const got = row?.value ?? ''
    return { ok: got === check.expect, kind: check.kind, detail: `${check.target}: ${got} / ${check.expect}` }
  }
  if (check.kind === 'timeUnder') {
    const limit = Number(check.expect)
    const ok = Number.isFinite(limit) && exchange.durationMs <= limit
    return { ok, kind: check.kind, detail: `${exchange.durationMs} / ${check.expect}` }
  }
  try {
    const value = readJsonPath(exchange.body, check.target)
    const got = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)
    return { ok: got === check.expect, kind: check.kind, detail: `${got} / ${check.expect}` }
  } catch {
    return { ok: false, kind: check.kind, detail: check.target }
  }
}

function readJsonPath(body: string, path: string): unknown {
  const parsed: unknown = JSON.parse(body)
  const parts = path.trim().split('.').filter((part) => part.length > 0)
  let current = parsed
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}
