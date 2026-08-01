/**
 * 从 SELECT / UPDATE / INSERT 粗解析主表（database.table），供结果列 meta 回填。
 * MySQL：schema 槽位 = database。
 */
export interface ParsedMysqlRelation {
  /** MySQL database 名 */
  database: string
  table: string
}

const IDENT = String.raw`(?:\`[^\`]+\`|"[^"]+"|[A-Za-z_][\w$]*)`
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`

const FROM_REL = new RegExp(String.raw`\bFROM\s+(${QUALIFIED})`, 'i')
const UPDATE_REL = new RegExp(
  String.raw`\bUPDATE\b(?:\s+(?:LOW_PRIORITY|IGNORE))*\s+(${QUALIFIED})`,
  'i',
)
const INSERT_REL = new RegExp(
  String.raw`\bINSERT\b(?:\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY|IGNORE))*\s+(?:INTO\s+)?(${QUALIFIED})`,
  'i',
)

function stripIdent(raw: string): string {
  const t = raw.trim()
  if (t.length >= 2) {
    if ((t.startsWith('`') && t.endsWith('`')) || (t.startsWith('"') && t.endsWith('"'))) {
      return t.slice(1, -1).replaceAll('``', '`').replaceAll('""', '"')
    }
  }
  return t
}

function splitQualifiers(raw: string): string[] {
  return raw
    .split('.')
    .map((p) => stripIdent(p.trim()))
    .filter(Boolean)
}

function parseQualified(
  captured: string,
  defaultDatabase: string,
): ParsedMysqlRelation | null {
  const withoutAlias = captured.replace(/\s+(?:AS\s+)?(?:`[^`]+`|"[^"]+"|[A-Za-z_][\w$]*)$/i, '').trim()
  const parts = splitQualifiers(withoutAlias.replace(/\s+/g, ''))
  if (parts.length === 0) return null
  if (parts.length === 1) {
    if (!defaultDatabase) return null
    return { database: defaultDatabase, table: parts[0]! }
  }
  return { database: parts[0]!, table: parts[1]! }
}

/**
 * 解析语句主目标表（优先 FROM，其次 UPDATE / INSERT）。
 */
export function parsePrimaryMysqlRelation(
  sql: string,
  defaultDatabase?: string,
): ParsedMysqlRelation | null {
  const db = defaultDatabase?.trim() || ''
  for (const re of [FROM_REL, UPDATE_REL, INSERT_REL]) {
    const m = re.exec(sql)
    if (!m?.[1]) continue
    const parsed = parseQualified(m[1].split(',')[0]!.trim(), db)
    if (parsed) return parsed
  }
  return null
}
