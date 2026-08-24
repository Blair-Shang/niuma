/**
 * T-SQL 对象脚本：解析名称；视图/过程/函数规范为 CREATE OR ALTER；
 * 已有序列规范为 ALTER SEQUENCE（引擎无 CREATE OR ALTER SEQUENCE）；
 * 已有同义词规范为 DROP + CREATE（引擎无 ALTER SYNONYM）。
 */
import type { SqlServerObjectKind, SqlServerObjectScriptMode } from '@/modules/sqlserver/types/object-script'

const KIND_PAT: Record<SqlServerObjectKind, string> = {
  view: 'view',
  procedure: '(?:proc(?:edure)?)',
  function: 'function',
  sequence: 'sequence',
  synonym: 'synonym',
}

const SYNONYM_QN =
  '(?:\\[[^\\]]*(?:\\]\\][^\\]]*)*\\]|[A-Za-z_@#][\\w@#$]*)(?:\\s*\\.\\s*(?:\\[[^\\]]*(?:\\]\\][^\\]]*)*\\]|[A-Za-z_@#][\\w@#$]*))?'

const IDENT = '(?:\\[([^\\]]*(?:\\]\\][^\\]]*)*)\\]|([A-Za-z_@#][\\w@#$]*))'

function unquote(bracket?: string, bare?: string): string {
  if (bracket) return bracket.replace(/]]/g, ']')
  return bare?.trim() ?? ''
}

export function parseSqlServerObjectNameFromSql(
  sql: string,
  kind: SqlServerObjectKind,
): string | null {
  let text = (sql ?? '').replace(/^\s*USE\s+\[[^\]]+\]\s*;?\s*(?:GO\s*)?/im, '').trim()
  if (kind === 'synonym') {
    text = text.replace(/^\s*drop\s+synonym\s+(?:if\s+exists\s+)?[^\n;]*;?\s*/i, '').trim()
  }
  if (!text) return null
  const re = new RegExp(
    `^\\s*(?:create(?:\\s+or\\s+alter)?|alter)\\s+${KIND_PAT[kind]}\\s+${IDENT}(?:\\s*\\.\\s*${IDENT})?`,
    'i',
  )
  const match = re.exec(text)
  if (!match) return null
  const qualified = unquote(match[3], match[4])
  if (qualified) return qualified
  const simple = unquote(match[1], match[2])
  return simple || null
}

/** 视图 / 过程 / 函数保存时用 CREATE OR ALTER。序列请用 normalizeObjectSaveSql。 */
export function toCreateOrAlterSql(sql: string, kind: SqlServerObjectKind): string {
  const text = (sql ?? '').trim()
  if (!text || kind === 'sequence' || kind === 'synonym') return text
  if (/^create\s+or\s+alter\s+/i.test(text)) return text
  return text.replace(/^create\s+/i, 'CREATE OR ALTER ')
}

/**
 * 已有序列对齐 SSMS Script as ALTER：CREATE → ALTER，START WITH → RESTART WITH。
 * AS 类型创建后不可改，从 ALTER 中去掉。
 */
export function toSequenceAlterSql(sql: string): string {
  const text = (sql ?? '').trim()
  if (!text) return text
  if (/^alter\s+sequence\b/i.test(text)) return text
  if (!/^create(?:\s+or\s+alter)?\s+sequence\b/i.test(text)) return text
  let next = text.replace(/^create(?:\s+or\s+alter)?\s+sequence\b/i, 'ALTER SEQUENCE')
  next = next.replace(/\s+AS\s+[A-Za-z][\w]*(?:\s*\([^)]*\))?/i, '')
  next = next.replace(/\bSTART\s+WITH\b/gi, 'RESTART WITH')
  return next
}

/**
 * 已有同义词对齐 SSMS Script as DROP and CREATE。
 * 引擎无 ALTER SYNONYM，改 FOR 目标只能删了再建。
 */
export function toSynonymReplaceSql(sql: string): string {
  const text = (sql ?? '').trim()
  if (!text) return text
  if (/^drop\s+synonym\b/i.test(text)) return text
  const match = new RegExp(`^create(?:\\s+or\\s+alter)?\\s+synonym\\s+(${SYNONYM_QN})`, 'i').exec(text)
  if (!match?.[1]) return text
  const qualified = match[1].replace(/\s+/g, '')
  const create = text.replace(/^create(?:\s+or\s+alter)?\s+synonym\b/i, 'CREATE SYNONYM')
  return `DROP SYNONYM IF EXISTS ${qualified};\n${create}`
}

/** 按对象类型与编辑模式生成可执行脚本。 */
export function normalizeObjectSaveSql(
  sql: string,
  kind: SqlServerObjectKind,
  mode: SqlServerObjectScriptMode,
): string {
  if (kind === 'sequence') {
    return mode === 'alter' ? toSequenceAlterSql(sql) : (sql ?? '').trim()
  }
  if (kind === 'synonym') {
    return mode === 'alter' ? toSynonymReplaceSql(sql) : (sql ?? '').trim()
  }
  return toCreateOrAlterSql(sql, kind)
}
