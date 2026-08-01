/**
 * Kingbase / PostgreSQL 客户端编码常见值。
 */
export const KINGBASE_CLIENT_ENCODINGS = [
  'UTF8',
  'GBK',
  'GB18030',
  'LATIN1',
  'SQL_ASCII',
] as const

export function normalizeKingbaseClientEncoding(raw: string | undefined, fallback = 'UTF8'): string {
  const v = (raw ?? '').trim()
  if (!v) return fallback
  if (!/^[A-Za-z0-9_]+$/.test(v)) return fallback
  return v
}

export function parseStatementTimeoutMs(raw: string | undefined): number {
  const n = Number.parseInt(String(raw ?? '').trim(), 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}
