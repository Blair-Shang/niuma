export type SqliteObjectKind = 'view' | 'trigger' | 'index'
export type SqliteObjectScriptMode = 'create' | 'alter'

export function objectKindToCategory(kind: SqliteObjectKind): string {
  switch (kind) {
    case 'trigger':
      return 'triggers'
    case 'index':
      return 'indexes'
    default:
      return 'views'
  }
}

export function objectKindIcon(kind: SqliteObjectKind): string {
  switch (kind) {
    case 'trigger':
      return 'zap'
    case 'index':
      return 'key'
    default:
      return 'eye'
  }
}

export function createObjectTemplate(kind: SqliteObjectKind, schema: string, name: string): string {
  const s = schema.trim() || 'main'
  const n = name.trim() || 'new_object'
  switch (kind) {
    // INDEX/TRIGGER：schema 挂在对象名上，ON 后只能是裸表名（不能 schema.table）
    case 'trigger':
      return `CREATE TRIGGER "${s}"."${n}"\nAFTER INSERT ON "table_name"\nBEGIN\n  SELECT 1;\nEND;\n`
    case 'index':
      return `CREATE INDEX "${s}"."${n}" ON "table_name" (column_name);\n`
    default:
      return `CREATE VIEW "${s}"."${n}" AS\nSELECT 1 AS col;\n`
  }
}

export function parseObjectNameFromSql(sql: string, kind: SqliteObjectKind): string {
  const patterns: Record<SqliteObjectKind, RegExp> = {
    view: /create\s+(?:or\s+replace\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:(?:"[^"]+"|\[[^\]]+\]|[^\s."\[\];()]+)\s*\.\s*)?(?:"([^"]+)"|\[([^\]]+)\]|([^\s."\[\];()]+))/i,
    trigger:
      /create\s+(?:or\s+replace\s+)?trigger\s+(?:if\s+not\s+exists\s+)?(?:(?:"[^"]+"|\[[^\]]+\]|[^\s."\[\];()]+)\s*\.\s*)?(?:"([^"]+)"|\[([^\]]+)\]|([^\s."\[\];()]+))/i,
    index:
      /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(?:(?:"[^"]+"|\[[^\]]+\]|[^\s."\[\];()]+)\s*\.\s*)?(?:"([^"]+)"|\[([^\]]+)\]|([^\s."\[\];()]+))/i,
  }
  const m = patterns[kind].exec(sql.trim())
  if (!m) return ''
  return (m[1] || m[2] || m[3] || '').trim()
}
