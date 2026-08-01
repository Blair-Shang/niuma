/**
 * 将达梦 DBMS_METADATA / ALL_SOURCE DDL 规范为可编辑形态。
 */
import type { DamengObjectKind } from '@/modules/dameng/types/object-script'

/** 标识符："name" / 'name' / bare */
const IDENT =
  '(?:"([^"]+)"|\'([^\']+)\'|([a-zA-Z0-9_$\\u0080-\\uffff]+))'

function collapseSpacesOnFirstLine(sql: string): string {
  const nl = sql.indexOf('\n')
  if (nl < 0) return sql.replace(/ {2,}/g, ' ')
  return sql.slice(0, nl).replace(/ {2,}/g, ' ') + sql.slice(nl)
}

function pickIdent(...groups: Array<string | undefined>): string | null {
  for (const g of groups) {
    const s = g?.trim()
    if (s) return s
  }
  return null
}

function kindPattern(kind: DamengObjectKind): string {
  switch (kind) {
    case 'view':
      return 'view'
    case 'procedure':
      return 'procedure'
    case 'function':
      return 'function'
    case 'package':
      return 'package(?:\\s+body)?'
    case 'trigger':
      return 'trigger'
    case 'synonym':
      return 'synonym'
    case 'sequence':
      return 'sequence'
    default:
      return 'function'
  }
}

/**
 * 从 CREATE … 正文解析对象名（取 schema.name 的 name 段）。
 * 包脚本可能含 PACKAGE + PACKAGE BODY，取首个匹配名。
 */
export function parseDamengObjectNameFromSql(
  sql: string,
  kind: DamengObjectKind,
): string | null {
  const s = (sql ?? '').trim()
  if (!s) return null

  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?${kindPattern(kind)}\\s+${IDENT}(?:\\s*\\.\\s*${IDENT})?`,
    'i',
  )
  const m = re.exec(s)
  if (!m) return null
  const qualified = pickIdent(m[4], m[5], m[6])
  if (qualified) return qualified
  return pickIdent(m[1], m[2], m[3])
}

/** 视图：改为 CREATE OR REPLACE 便于再次保存。 */
export function normalizeDamengViewDdlForEdit(ddl: string): string {
  let s = (ddl ?? '').trim()
  if (!s) return s
  if (!/^create\s+or\s+replace\s+/i.test(s)) {
    s = s.replace(/^create\s+/i, 'CREATE OR REPLACE ')
  }
  return collapseSpacesOnFirstLine(s).trim()
}

/** 过程/函数：尽量补上 OR REPLACE，便于再次保存。 */
export function normalizeDamengRoutineDdlForEdit(ddl: string): string {
  let s = (ddl ?? '').trim()
  if (!s) return s
  if (/^create\s+(procedure|function)\b/i.test(s) && !/^create\s+or\s+replace\s+/i.test(s)) {
    s = s.replace(/^create\s+/i, 'CREATE OR REPLACE ')
  }
  return collapseSpacesOnFirstLine(s).trim()
}

/**
 * 包 / 触发器 / 同义词：对每条 CREATE 块补 OR REPLACE（序列除外）。
 * 保留客户端 `/` 终止符以便拆句执行。
 */
export function normalizeDamengObjectDdlForEdit(ddl: string, kind: DamengObjectKind): string {
  const s = (ddl ?? '').trim()
  if (!s) return s
  if (kind === 'view') return normalizeDamengViewDdlForEdit(s)
  if (kind === 'procedure' || kind === 'function') return normalizeDamengRoutineDdlForEdit(s)
  if (kind === 'sequence') return collapseSpacesOnFirstLine(s).trim()

  // 多语句（包规格+包体）：逐段补 OR REPLACE
  const parts = s.split(/\n\/\s*\n/).map((p) => p.trim()).filter(Boolean)
  const fixed = parts.map((part) => {
    let block = part.replace(/\/\s*$/, '').trim()
    if (
      /^create\s+(package(?:\s+body)?|trigger|synonym)\b/i.test(block) &&
      !/^create\s+or\s+replace\s+/i.test(block)
    ) {
      block = block.replace(/^create\s+/i, 'CREATE OR REPLACE ')
    }
    return collapseSpacesOnFirstLine(block).trim()
  })
  if (fixed.length <= 1) {
    return fixed[0] ?? s
  }
  return fixed.map((b) => (b.endsWith('/') ? b : `${b}\n/`)).join('\n\n')
}

export function toReplaceSql(sql: string): string {
  const trimmed = sql.trim()
  if (/^create\s+or\s+replace\s+/i.test(trimmed)) return trimmed
  if (/^create\s+sequence\b/i.test(trimmed)) return trimmed
  return trimmed.replace(/^create\s+/i, 'CREATE OR REPLACE ')
}
