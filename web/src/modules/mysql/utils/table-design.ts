/**
 * MySQL 表设计器草稿类型与工具函数。
 */

export type DataTypeParamKind = 'none' | 'length' | 'precision' | 'enum'

export interface MysqlBaseTypeOption {
  base: string
  kind: DataTypeParamKind
  defaultLength?: number
  defaultPrecision?: number
  defaultScale?: number
  /** 是否支持 UNSIGNED（整数 / DECIMAL） */
  allowUnsigned?: boolean
}

export const MYSQL_BASE_TYPE_OPTIONS: MysqlBaseTypeOption[] = [
  { base: 'INT', kind: 'none', allowUnsigned: true },
  { base: 'BIGINT', kind: 'none', allowUnsigned: true },
  { base: 'SMALLINT', kind: 'none', allowUnsigned: true },
  { base: 'TINYINT', kind: 'none', allowUnsigned: true },
  { base: 'MEDIUMINT', kind: 'none', allowUnsigned: true },
  { base: 'FLOAT', kind: 'none' },
  { base: 'DOUBLE', kind: 'none' },
  { base: 'DECIMAL', kind: 'precision', defaultPrecision: 10, defaultScale: 2, allowUnsigned: true },
  { base: 'VARCHAR', kind: 'length', defaultLength: 255 },
  { base: 'CHAR', kind: 'length', defaultLength: 1 },
  { base: 'TEXT', kind: 'none' },
  { base: 'MEDIUMTEXT', kind: 'none' },
  { base: 'LONGTEXT', kind: 'none' },
  { base: 'TINYTEXT', kind: 'none' },
  { base: 'BOOLEAN', kind: 'none' },
  { base: 'DATE', kind: 'none' },
  { base: 'DATETIME', kind: 'none' },
  { base: 'TIMESTAMP', kind: 'none' },
  { base: 'TIME', kind: 'none' },
  { base: 'YEAR', kind: 'none' },
  { base: 'JSON', kind: 'none' },
  { base: 'BLOB', kind: 'none' },
  { base: 'MEDIUMBLOB', kind: 'none' },
  { base: 'LONGBLOB', kind: 'none' },
  { base: 'TINYBLOB', kind: 'none' },
  { base: 'ENUM', kind: 'enum' },
  { base: 'SET', kind: 'enum' },
  { base: 'BINARY', kind: 'length', defaultLength: 16 },
  { base: 'VARBINARY', kind: 'length', defaultLength: 255 },
]

/** @deprecated 使用 MYSQL_BASE_TYPE_OPTIONS */
export const MYSQL_BASE_TYPES: string[] = MYSQL_BASE_TYPE_OPTIONS.map((o) => o.base)

export const MYSQL_FK_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL'] as const
export type MysqlFkAction = (typeof MYSQL_FK_ACTIONS)[number]

export interface ParsedDataType {
  base: string
  length?: number
  precision?: number
  scale?: number
  unsigned: boolean
  /** ENUM/SET 括号内原文，如 'a','b' */
  enumValues?: string
  raw: string
}

export interface DesignColumnDraft {
  __rowKey: string
  originalName: string
  name: string
  /** 完整类型字面量，如 VARCHAR(255)、INT UNSIGNED、ENUM('a','b') */
  dataType: string
  typeBase: string
  typeLength?: number
  typeScale?: number
  unsigned: boolean
  /** ENUM/SET 值列表原文（不含外层括号） */
  enumValues: string
  nullable: boolean
  defaultExpr: string
  primaryKey: boolean
  autoIncrement: boolean
  comment: string
  removed: boolean
}

export interface DesignIndexDraft {
  __rowKey: string
  originalName: string
  name: string
  columnsText: string
  unique: boolean
  primary: boolean
  /** BTREE / HASH */
  method: string
  removed: boolean
  snapName: string
  snapColumnsText: string
  snapUnique: boolean
  snapMethod: string
}

export interface DesignForeignKeyDraft {
  __rowKey: string
  originalName: string
  name: string
  columnsText: string
  refTable: string
  refColumnsText: string
  onDelete: string
  onUpdate: string
  removed: boolean
}

let draftCounter = 0
export function nextDraftKey(prefix: string): string {
  return `${prefix}-${++draftCounter}`
}

export function resolveBaseTypeOption(base: string): MysqlBaseTypeOption | undefined {
  const upper = base.trim().toUpperCase()
  return MYSQL_BASE_TYPE_OPTIONS.find((o) => o.base.toUpperCase() === upper)
}

export function dataTypeParamKind(base: string): DataTypeParamKind {
  return resolveBaseTypeOption(base)?.kind ?? 'none'
}

export function allowsUnsigned(base: string): boolean {
  return Boolean(resolveBaseTypeOption(base)?.allowUnsigned)
}

export function newEmptyColumn(): DesignColumnDraft {
  return {
    __rowKey: nextDraftKey('col-new'),
    originalName: '',
    name: '',
    dataType: 'VARCHAR(255)',
    typeBase: 'VARCHAR',
    typeLength: 255,
    unsigned: false,
    enumValues: '',
    nullable: true,
    defaultExpr: '',
    primaryKey: false,
    autoIncrement: false,
    comment: '',
    removed: false,
  }
}

/** 新建表默认列：id BIGINT AUTO_INCREMENT PRIMARY KEY（对齐 Navicat / DBeaver）。 */
export function defaultCreateTableColumns(): DesignColumnDraft[] {
  return [
    {
      __rowKey: nextDraftKey('col-id'),
      originalName: '',
      name: 'id',
      dataType: 'BIGINT',
      typeBase: 'BIGINT',
      unsigned: false,
      enumValues: '',
      nullable: false,
      defaultExpr: '',
      primaryKey: true,
      autoIncrement: true,
      comment: '',
      removed: false,
    },
  ]
}

export function newEmptyIndex(): DesignIndexDraft {
  return {
    __rowKey: nextDraftKey('idx-new'),
    originalName: '',
    name: '',
    columnsText: '',
    unique: false,
    primary: false,
    method: 'BTREE',
    removed: false,
    snapName: '',
    snapColumnsText: '',
    snapUnique: false,
    snapMethod: 'BTREE',
  }
}

export function newEmptyForeignKey(): DesignForeignKeyDraft {
  return {
    __rowKey: nextDraftKey('fk-new'),
    originalName: '',
    name: '',
    columnsText: '',
    refTable: '',
    refColumnsText: '',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    removed: false,
  }
}

/** 解析类型字符串，支持 UNSIGNED / ENUM / SET。 */
export function parseDataType(raw: string): ParsedDataType {
  let trimmed = raw.trim()
  const unsigned = /\bUNSIGNED\b/i.test(trimmed)
  if (unsigned) {
    trimmed = trimmed.replace(/\bUNSIGNED\b/gi, '').replace(/\s+/g, ' ').trim()
  }

  const enumMatch = trimmed.match(/^([A-Za-z]+)\s*\(([\s\S]*)\)\s*$/i)
  if (enumMatch) {
    const base = enumMatch[1].toUpperCase()
    const inner = enumMatch[2].trim()
    if (base === 'ENUM' || base === 'SET') {
      return { base, unsigned: false, enumValues: inner, raw }
    }
    const nums = inner.match(/^(\d+)(?:,\s*(\d+))?$/)
    if (nums) {
      const first = parseInt(nums[1], 10)
      const second = nums[2] != null ? parseInt(nums[2], 10) : undefined
      if (second !== undefined) {
        return { base, precision: first, scale: second, unsigned, raw }
      }
      return { base, length: first, unsigned, raw }
    }
  }

  const baseOnly = trimmed.toUpperCase()
  return { base: baseOnly, unsigned, raw }
}

export function buildDataType(
  base: string,
  opts?: {
    length?: number
    scale?: number
    unsigned?: boolean
    enumValues?: string
  },
): string {
  const opt = resolveBaseTypeOption(base)
  const kind = opt?.kind ?? 'none'
  let core = base.toUpperCase()

  if (kind === 'enum') {
    const values = (opts?.enumValues ?? '').trim()
    core = values ? `${core}(${values})` : core
  } else if (kind === 'length' && opts?.length != null) {
    core = `${core}(${opts.length})`
  } else if (kind === 'precision' && opts?.length != null) {
    core =
      opts.scale != null ? `${core}(${opts.length},${opts.scale})` : `${core}(${opts.length})`
  }

  if (opts?.unsigned && allowsUnsigned(base)) {
    return `${core} UNSIGNED`
  }
  return core
}

export function syncColumnDataType(col: Pick<
  DesignColumnDraft,
  'typeBase' | 'typeLength' | 'typeScale' | 'unsigned' | 'enumValues'
>): string {
  return buildDataType(col.typeBase, {
    length: col.typeLength,
    scale: col.typeScale,
    unsigned: col.unsigned,
    enumValues: col.enumValues,
  })
}

export function splitDataTypeFields(raw: string): {
  dataType: string
  typeBase: string
  typeLength?: number
  typeScale?: number
  unsigned: boolean
  enumValues: string
} {
  const p = parseDataType(raw)
  return {
    dataType: buildDataType(p.base, {
      length: p.length ?? p.precision,
      scale: p.scale,
      unsigned: p.unsigned,
      enumValues: p.enumValues,
    }),
    typeBase: p.base,
    typeLength: p.length ?? p.precision,
    typeScale: p.scale,
    unsigned: p.unsigned,
    enumValues: p.enumValues ?? '',
  }
}

export function parseColumnList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function joinColumnList(cols: string[]): string {
  return cols.map((c) => c.trim()).filter(Boolean).join(', ')
}

export function suggestIndexName(columnsText: string, fallback = 'idx'): string {
  const cols = parseColumnList(columnsText)
  if (cols.length === 0) return fallback
  return `idx_${cols.join('_').slice(0, 48)}`
}

export function isDefaultIndexName(name: string): boolean {
  return !name.trim() || /^idx(_|$)/i.test(name.trim())
}

/** 已带引号 / 关键字 / 数字 / 函数的 DEFAULT，原样输出；其余按字符串字面量加单引号。 */
const MYSQL_DEFAULT_BARE_RE =
  /^(NULL|TRUE|FALSE|CURRENT_(?:TIMESTAMP|DATE|TIME|USER)(?:\(\d*\))?|LOCALTIME(?:\(\d*\))?|LOCALTIMESTAMP(?:\(\d*\))?|UTC_TIMESTAMP(?:\(\d*\))?|NOW\(\))$/i
const MYSQL_DEFAULT_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const MYSQL_DEFAULT_HEX_BIT_RE = /^(0x[0-9a-fA-F]+|[xX]'[0-9a-fA-F]*'|[bB]'[01]*')$/

/**
 * 将 UI 中的默认值整理为可写入 DEFAULT 子句的 SQL 片段。
 * information_schema 返回的字符串默认值通常无引号，直接拼接会触发 1064。
 */
export function formatMysqlDefaultExpr(expr: string): string {
  const e = expr.trim()
  if (!e) return ''
  if (
    (e.startsWith("'") && e.endsWith("'")) ||
    (e.startsWith('"') && e.endsWith('"'))
  ) {
    return e
  }
  if (MYSQL_DEFAULT_BARE_RE.test(e)) return e
  if (MYSQL_DEFAULT_NUMBER_RE.test(e)) return e
  if (MYSQL_DEFAULT_HEX_BIT_RE.test(e)) return e
  if (e.startsWith('(') && e.endsWith(')')) return e
  return `'${e.replace(/'/g, "''")}'`
}

export function columnsEqual(a: DesignColumnDraft, b: DesignColumnDraft): boolean {
  return (
    a.name === b.name &&
    a.dataType === b.dataType &&
    a.nullable === b.nullable &&
    a.defaultExpr === b.defaultExpr &&
    a.comment === b.comment &&
    a.autoIncrement === b.autoIncrement &&
    a.primaryKey === b.primaryKey &&
    a.unsigned === b.unsigned &&
    a.enumValues === b.enumValues
  )
}
