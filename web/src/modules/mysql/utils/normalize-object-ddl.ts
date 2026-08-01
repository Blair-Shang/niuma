/**
 * 将 MySQL SHOW CREATE VIEW / 例程 DDL 规范为「可编辑」形态：
 * 去掉 ALGORITHM / DEFINER / SQL SECURITY，避免创建后切编辑像另一段脚本。
 */
import type { MysqlObjectKind } from '@/modules/mysql/types/object-script'

/** 去掉 DEFINER=`user`@`host`（兼容格式化后的空格与引号变体）。 */
const DEFINER_RE =
  /\bDEFINER\s*=\s*(?:`[^`]+`|'[^']+'|[^\s@]+)\s*@\s*(?:`[^`]+`|'[^']+'|[^\s]+)\s+/gi

const ALGORITHM_RE = /\bALGORITHM\s*=\s*\w+\s+/gi
const SQL_SECURITY_RE = /\bSQL\s+SECURITY\s+(?:DEFINER|INVOKER)\s+/gi

/** 标识符：`name` / "name" / 'name' / bare */
const IDENT =
  '(?:`([^`]+)`|"([^"]+)"|\'([^\']+)\'|([a-zA-Z0-9_$\\u0080-\\uffff]+))'

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

/**
 * 从 CREATE VIEW / PROCEDURE / FUNCTION 正文解析对象名（取 `db`.`name` 的 name 段）。
 * 用于保存时 DROP 真实目标，避免仍用新建占位名 new_proc / new_func。
 */
export function parseMysqlObjectNameFromSql(
  sql: string,
  kind: MysqlObjectKind,
): string | null {
  let s = (sql ?? '').trim()
  if (!s) return null
  // 跳过客户端 DELIMITER 行，定位首条 CREATE
  s = s.replace(/^\s*DELIMITER\b[^\n]*\n?/gim, '').trim()
  s = s.replace(DEFINER_RE, '')
  s = s.replace(ALGORITHM_RE, '')
  s = s.replace(SQL_SECURITY_RE, '')

  let kindPat = 'function'
  if (kind === 'view') kindPat = 'view'
  else if (kind === 'procedure') kindPat = 'procedure'
  const re = new RegExp(
    `^\\s*create\\s+(?:or\\s+replace\\s+)?${kindPat}\\s+${IDENT}(?:\\s*\\.\\s*${IDENT})?`,
    'i',
  )
  const m = re.exec(s)
  if (!m) return null
  // 有库前缀时取第二段，否则取第一段
  const qualified = pickIdent(m[5], m[6], m[7], m[8])
  if (qualified) return qualified
  return pickIdent(m[1], m[2], m[3], m[4])
}

/** 视图：去掉元数据子句，并改为 CREATE OR REPLACE 便于再次保存。 */
export function normalizeMysqlViewDdlForEdit(ddl: string): string {
  let s = (ddl ?? '').trim()
  if (!s) return s
  s = s.replace(ALGORITHM_RE, '')
  s = s.replace(DEFINER_RE, '')
  s = s.replace(SQL_SECURITY_RE, '')
  if (!/^create\s+or\s+replace\s+/i.test(s)) {
    s = s.replace(/^create\s+/i, 'CREATE OR REPLACE ')
  }
  return collapseSpacesOnFirstLine(s).trim()
}

/** 过程/函数：仅去掉 DEFINER，保留 CREATE PROCEDURE/FUNCTION 原文结构。 */
export function normalizeMysqlRoutineDdlForEdit(ddl: string): string {
  let s = (ddl ?? '').trim()
  if (!s) return s
  s = s.replace(DEFINER_RE, '')
  return collapseSpacesOnFirstLine(s).trim()
}
