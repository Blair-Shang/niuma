import type { OracleObjectKind } from '@/modules/oracle/types/object-script'
import { quoteIdent } from '@/modules/oracle/sql-seed'

const IDENT = '(?:"([^"]+)"|\'([^\']+)\'|([a-zA-Z0-9_$\\u0080-\\uffff]+))'
const IDENT_TOKEN = '(?:"[^"]+"|[A-Za-z][A-Za-z0-9_$#]*)'
/** 支持 schema 限定的 CREATE 对象种类（含 PACKAGE BODY）。 */
const CREATE_KIND =
  'procedure|function|package(?:\\s+body)?|view|synonym|trigger|sequence'
/** 需要 SQL*Plus `/` 终止符的 PL/SQL 单元。 */
const PLSQL_KIND = 'procedure|function|package(?:\\s+body)?|trigger'

function pick(...groups: Array<string | undefined>): string | null {
  return groups.find((group) => Boolean(group?.trim()))?.trim() ?? null
}

function collapseSpacesOnFirstLine(sql: string): string {
  const nl = sql.indexOf('\n')
  if (nl < 0) return sql.replace(/ {2,}/g, ' ')
  return sql.slice(0, nl).replace(/ {2,}/g, ' ') + sql.slice(nl)
}

function isPlsqlCreateUnit(sql: string): boolean {
  return new RegExp(
    `^\\s*create\\s+(?:or\\s+replace\\s+)?(?:(?:non)?editionable\\s+)?(${PLSQL_KIND})\\b`,
    'i',
  ).test(sql)
}

/** 按独占行 `/` 拆成多个 CREATE 单元（包规格+包体）。 */
export function splitOracleSqlPlusUnits(sql: string): string[] {
  const trimmed = (sql ?? '').replace(/[ \t\r\n]+$/u, '')
  if (!trimmed) return []
  return trimmed
    .split(/\n\/\s*\n/)
    .map((part) => part.replace(/\/\s*$/u, '').trim())
    .filter(Boolean)
}

const PACKAGE_BODY_CREATE_RE =
  /(?:^|\n)[ \t]*create\s+(?:or\s+replace\s+)?(?:(?:non)?editionable\s+)?package\s+body\b/i

/**
 * 合并 meta.packageSource 的 definition + bodyDefinition。
 * 若 definition 已含 PACKAGE BODY（旧后端 / GET_DDL 合并），不再二次拼接 body。
 */
export function joinOraclePackageSource(
  definition?: string | null,
  bodyDefinition?: string | null,
): string {
  const def = (definition ?? '').trim()
  const body = (bodyDefinition ?? '').trim()
  if (!def) return body
  if (!body) return def
  if (PACKAGE_BODY_CREATE_RE.test(def)) return def
  return `${def}\n/\n\n${body}`
}

export function parseOracleObjectNameFromSql(sql: string, kind: OracleObjectKind): string | null {
  const type = kind === 'package' ? 'package(?:\\s+body)?' : kind
  const match = new RegExp(
    `^\\s*create\\s+(?:or\\s+replace\\s+)?${type}\\s+${IDENT}(?:\\s*\\.\\s*${IDENT})?`,
    'i',
  ).exec(sql.trim())
  if (!match) return null
  return pick(match[4], match[5], match[6]) ?? pick(match[1], match[2], match[3])
}

/**
 * 规范为可再次执行的 CREATE OR REPLACE 形态。
 * - ALL_SOURCE 常以 PROCEDURE/FUNCTION/PACKAGE [BODY] 开头（无 CREATE）
 * - DBMS_METADATA 常为 CREATE [OR REPLACE] ...
 * - TABLE / SEQUENCE 保持 CREATE（不支持或不宜用 OR REPLACE；序列 23ai 前无 OR REPLACE）
 */
export function toReplaceSql(sql: string): string {
  const value = (sql ?? '').trim()
  if (!value) return value
  // 序列：剥掉误加的 OR REPLACE（23ai 前 ORA-00922），其余保持 CREATE SEQUENCE
  if (/^create\s+(?:or\s+replace\s+)?sequence\b/i.test(value)) {
    return value.replace(/^create\s+or\s+replace\s+/i, 'CREATE ')
  }
  if (/^create\s+or\s+replace\s+/i.test(value)) return value
  // TABLE：不支持 OR REPLACE
  if (/^create\s+table\b/i.test(value)) return value
  // ALL_SOURCE：裸 PROCEDURE / FUNCTION / PACKAGE [BODY] / TRIGGER
  if (/^(procedure|function|package|trigger)(\s|\()/i.test(value)) {
    return `CREATE OR REPLACE ${value}`
  }
  if (/^create\s+/i.test(value)) {
    return value.replace(/^create\s+/i, 'CREATE OR REPLACE ')
  }
  return value
}

function qualifyCreateUnit(sql: string, schema: string): string {
  const sch = schema.trim()
  const value = toReplaceSql(sql)
  if (!sch || !value) return value
  const head = new RegExp(
    `^(\\s*create\\s+(?:or\\s+replace\\s+)?(?:(?:non)?editionable\\s+)?)(${CREATE_KIND})\\s+`,
    'i',
  ).exec(value)
  if (!head) return value
  const afterKind = value.slice(head[0].length)
  if (new RegExp(`^${IDENT_TOKEN}\\s*\\.`).test(afterKind)) {
    return value
  }
  if (!new RegExp(`^${IDENT_TOKEN}`).test(afterKind)) {
    return value
  }
  return `${head[0]}${quoteIdent(sch)}.${afterKind}`
}

/**
 * 为 CREATE 对象补上 schema 限定名（过程/函数/包/视图/同义词/触发器/序列）。
 * CURRENT_SCHEMA 不决定 CREATE 落点；无 schema 时会建到登录用户下。
 * 多单元脚本（包规格+包体，以独占行 `/` 分隔）逐段限定。
 */
export function ensureOracleCreateSchema(sql: string, schema: string): string {
  const sch = schema.trim()
  const raw = sql ?? ''
  if (!raw.trim()) return raw
  if (!sch) return toReplaceSql(raw)

  const hasSlashUnits = /\n\/\s*\n/.test(raw) || /\n\/\s*$/u.test(raw.replace(/[ \t\r\n]+$/u, ''))
  if (hasSlashUnits) {
    const units = splitOracleSqlPlusUnits(raw)
    if (units.length > 1) {
      return units
        .map((unit) => qualifyCreateUnit(unit, sch))
        .map((unit) =>
          isPlsqlCreateUnit(unit) ? `${stripOracleSqlPlusTerminator(unit)}\n/` : unit,
        )
        .join('\n\n')
    }
  }
  return qualifyCreateUnit(raw, sch)
}

/**
 * 去掉 DBMS_METADATA.GET_DDL(TRIGGER) 尾部的 `ALTER TRIGGER … ENABLE/DISABLE`。
 * SQLTERMINATOR=TRUE 时常为独立行 `/` + ALTER；formatSql 也可能粘成 `/ ALTER …`。
 * 编辑/再保存只需 CREATE OR REPLACE TRIGGER 本体。
 */
export function stripOracleTriggerAlterTrailer(ddl: string): string {
  let s = (ddl ?? '').replace(/[ \t\r\n]+$/u, '')
  if (!s) return s
  // 允许：`\n/\nALTER…`、`\n/ ALTER…`、无斜杠的尾部 `ALTER TRIGGER … ENABLE|DISABLE`
  s = s.replace(
    /(?:^|\n)[ \t]*(?:\/[ \t]*(?:\n[ \t]*)?)?ALTER\s+TRIGGER\b[\s\S]*?\b(?:ENABLE|DISABLE)\s*;?[ \t]*$/i,
    '',
  )
  return s.replace(/[ \t\r\n]+$/u, '')
}

function isAlterTriggerUnit(sql: string): boolean {
  return /^\s*\/?\s*ALTER\s+TRIGGER\b/i.test(sql)
}

/**
 * 规范为可编辑/可再次保存形态。
 * - 序列：保持 CREATE SEQUENCE（剥掉误加的 OR REPLACE），并补 schema
 * - 包/触发器等：逐 CREATE 块补 OR REPLACE + schema；PL/SQL 保留独占行 `/`
 * - 触发器：剥掉 GET_DDL 附带的 ALTER TRIGGER ENABLE/DISABLE
 */
export function normalizeOracleObjectDdlForEdit(
  ddl: string,
  schema?: string,
  kind?: OracleObjectKind,
): string {
  let value = (ddl ?? '').trim()
  if (!value) return value

  if (kind === 'sequence') {
    value = value.replace(/^create\s+or\s+replace\s+sequence\b/i, 'CREATE SEQUENCE')
    value = collapseSpacesOnFirstLine(value)
    const sch = schema?.trim()
    if (sch) value = ensureOracleCreateSchema(value, sch)
    return value
  }

  if (kind === 'trigger' || /alter\s+trigger\b/i.test(value)) {
    value = stripOracleTriggerAlterTrailer(value)
  }

  const units = splitOracleSqlPlusUnits(value).filter((unit) => !isAlterTriggerUnit(unit))
  if (units.length > 1) {
    const fixed = units.map((unit) => collapseSpacesOnFirstLine(toReplaceSql(unit)))
    let joined = fixed
      .map((block) =>
        isPlsqlCreateUnit(block) ? `${stripOracleSqlPlusTerminator(block)}\n/` : block,
      )
      .join('\n\n')
    const sch = schema?.trim()
    if (sch) joined = ensureOracleCreateSchema(joined, sch)
    return joined.endsWith('\n') ? joined : `${joined}\n`
  }

  // 拆分后只剩 CREATE（或未拆分）：走单单元路径
  value = units[0] ?? value
  let replaced = collapseSpacesOnFirstLine(toReplaceSql(value))
  const sch = schema?.trim()
  if (sch) replaced = ensureOracleCreateSchema(replaced, sch)
  return ensureOraclePlsqlScriptTerminator(replaced)
}

/**
 * 去掉 SQL*Plus 客户端终止符 `/`（OCI/ODPI 不认，会进 ALL_ERRORS 成 PLS-00103）：
 * - 末尾独占一行的 `/`
 * - 同行尾 `END;/` / `END; /`
 * - 行首粘连的 `/ ALTER…`（formatSql 把独占行 `/` 与下一句并到同行）
 * 编辑器里可保留 `/`；提交前由拆句或本函数剥离。
 */
export function stripOracleSqlPlusTerminator(sql: string): string {
  let s = (sql ?? '').replace(/[ \t\r\n]+$/u, '')
  // 行首 `/ `（非独占行终止符）：不能送给 OCI
  s = s.replace(/^\s*\/[ \t]+/u, '')
  const lines = s.split(/\r?\n/)
  while (lines.length > 0 && /^\s*\/\s*$/.test(lines[lines.length - 1]!)) {
    lines.pop()
  }
  s = lines.join('\n').replace(/[ \t\r\n]+$/u, '')
  // 同行尾斜杠（拆句未识别 PL/SQL 时常见）
  s = s.replace(/[ \t]*\/[ \t]*$/u, '')
  return s.replace(/[ \t\r\n]+$/u, '')
}

/**
 * 过程/函数/包/触发器脚本末尾补独占行 `/`（对齐 SQL*Plus / 新建模板）。
 * 已有则先剥再补，避免重复。多单元脚本（中间已有 `/`）原样返回。
 */
export function ensureOraclePlsqlScriptTerminator(sql: string): string {
  const raw = (sql ?? '').replace(/[ \t\r\n]+$/u, '')
  if (!raw.trim()) return raw
  // 多单元已带分隔 `/`，勿合并成单一终止符
  if (/\n\/\s*\n/.test(raw)) return raw.endsWith('\n') ? raw : `${raw}\n`
  if (
    !new RegExp(
      `^\\s*create\\s+(?:or\\s+replace\\s+)?(?:(?:non)?editionable\\s+)?(${PLSQL_KIND})\\b`,
      'i',
    ).test(raw)
  ) {
    return raw
  }
  const body = stripOracleSqlPlusTerminator(raw)
  return body ? `${body}\n/\n` : body
}
