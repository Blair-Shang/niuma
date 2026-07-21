/**
 * Vastbase / PostgreSQL 客户端编码常见值（libpq client_encoding）。
 * 默认 UTF8；历史站点若存了其它值会在下拉中保留。
 */
export const VAST_CLIENT_ENCODINGS = [
  'UTF8',
  'GBK',
  'GB18030',
  'LATIN1',
  'SQL_ASCII',
] as const

export type VastClientEncoding = (typeof VAST_CLIENT_ENCODINGS)[number]

/** 规范化 client_encoding；空或非法则回退 UTF8。 */
export function normalizeVastClientEncoding(raw: string | undefined, fallback = 'UTF8'): string {
  const v = (raw ?? '').trim()
  if (!v) return fallback
  if (!/^[A-Za-z0-9_]+$/.test(v)) return fallback
  return v
}

/** 解析语句超时毫秒；非法或负数视为 0（不限制）。 */
export function parseStatementTimeoutMs(raw: string | undefined): number {
  const n = Number.parseInt(String(raw ?? '').trim(), 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}
