/**
 * 从 Postgres CREATE VIEW / FUNCTION / PROCEDURE / SEQUENCE 正文解析对象名。
 * 支持 schema.name 与 "schema"."name"；有 schema 时取 name 段。
 */
import type { PostgresObjectKind } from '@/modules/postgres/types/object-script'

const IDENT =
  '(?:"([^"]+)"|\'([^\']+)\'|([a-zA-Z_\\u0080-\\uffff][a-zA-Z0-9_$\\u0080-\\uffff]*))'

function pickIdent(...groups: Array<string | undefined>): string | null {
  for (const g of groups) {
    const s = g?.trim()
    if (s) return s
  }
  return null
}

export function parsePostgresObjectNameFromSql(
  sql: string,
  kind: PostgresObjectKind,
): string | null {
  let s = (sql ?? '').trim()
  if (!s) return null

  let kindPat = 'function'
  if (kind === 'view') kindPat = 'view'
  else if (kind === 'procedure') kindPat = 'procedure'
  else if (kind === 'sequence') kindPat = 'sequence'

  const re = new RegExp(
    `^\\s*create\\s+(?:or\\s+replace\\s+)?${kindPat}\\s+${IDENT}(?:\\s*\\.\\s*${IDENT})?`,
    'i',
  )
  const m = re.exec(s)
  if (!m) return null
  // 有 schema 前缀时取第二段，否则取第一段
  const qualified = pickIdent(m[4], m[5], m[6])
  if (qualified) return qualified
  return pickIdent(m[1], m[2], m[3])
}

/** 视图：改为 CREATE OR REPLACE，便于再次保存。 */
export function toReplaceViewSql(sql: string): string {
  const trimmed = (sql ?? '').trim()
  if (!trimmed) return trimmed
  if (/^create\s+or\s+replace\s+/i.test(trimmed)) return trimmed
  return trimmed.replace(/^create\s+/i, 'CREATE OR REPLACE ')
}
