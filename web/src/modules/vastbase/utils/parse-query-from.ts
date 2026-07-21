/**
 * 从 SELECT 语句粗解析主 FROM 关系（schema.table），供结果列 meta 回填。
 * 不替代 SQL parser；仅覆盖常见单表查询。
 */

export interface ParsedFromRelation {
  schema: string
  table: string
}

const IDENT = String.raw`(?:"[^"]+"|[a-zA-Z_][\w$]*)`
const FROM_REL = new RegExp(String.raw`\bFROM\s+(${IDENT}(?:\s*\.\s*${IDENT}){0,2})`, 'i')

function stripIdent(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replaceAll('""', '"')
  }
  return t
}

function splitQualifiers(raw: string): string[] {
  return raw
    .split('.')
    .map((p) => stripIdent(p.trim()))
    .filter(Boolean)
}

/**
 * 解析主 FROM 表。
 * - `table` → public.table
 * - `schema.table`
 * - `database.schema.table`：首段与 database 相同时去掉库前缀
 */
export function parsePrimaryFromRelation(
  sql: string,
  database?: string,
  defaultSchema = 'public',
): ParsedFromRelation | null {
  const m = FROM_REL.exec(sql)
  if (!m?.[1]) return null
  const captured = m[1].split(',')[0]!.trim()
  const withoutAlias = captured.replace(/\s+(?:AS\s+)?[a-zA-Z_][\w$]*$/i, '').trim()
  const parts = splitQualifiers(withoutAlias.replace(/\s+/g, ''))
  if (parts.length === 0) return null
  if (parts.length === 1) {
    return { schema: defaultSchema, table: parts[0]! }
  }
  if (parts.length === 2) {
    return { schema: parts[0]!, table: parts[1]! }
  }
  const db = database?.trim()
  if (db && parts[0] === db) {
    return { schema: parts[1]!, table: parts[2]! }
  }
  return { schema: parts[1]!, table: parts[2]! }
}
