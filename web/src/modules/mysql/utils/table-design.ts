/**
 * MySQL 表设计器草稿类型与工具函数。
 */

export const MYSQL_BASE_TYPES: string[] = [
  'INT',
  'BIGINT',
  'SMALLINT',
  'TINYINT',
  'MEDIUMINT',
  'FLOAT',
  'DOUBLE',
  'DECIMAL',
  'VARCHAR',
  'CHAR',
  'TEXT',
  'MEDIUMTEXT',
  'LONGTEXT',
  'TINYTEXT',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'TIME',
  'YEAR',
  'JSON',
  'BLOB',
  'MEDIUMBLOB',
  'LONGBLOB',
  'TINYBLOB',
]

export type DataTypeParamKind = 'none' | 'length' | 'precision'

export interface MysqlBaseTypeOption {
  base: string
  kind: DataTypeParamKind
  defaultLength?: number
  defaultPrecision?: number
  defaultScale?: number
}

export const MYSQL_BASE_TYPE_OPTIONS: MysqlBaseTypeOption[] = [
  { base: 'INT', kind: 'none' },
  { base: 'BIGINT', kind: 'none' },
  { base: 'SMALLINT', kind: 'none' },
  { base: 'TINYINT', kind: 'none' },
  { base: 'MEDIUMINT', kind: 'none' },
  { base: 'FLOAT', kind: 'none' },
  { base: 'DOUBLE', kind: 'none' },
  { base: 'DECIMAL', kind: 'precision', defaultPrecision: 10, defaultScale: 2 },
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
]

export const MYSQL_FK_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL'] as const
export type MysqlFkAction = (typeof MYSQL_FK_ACTIONS)[number]

export interface ParsedDataType {
  base: string
  length?: number
  precision?: number
  scale?: number
  raw: string
}

export interface DesignColumnDraft {
  __rowKey: string
  originalName: string
  name: string
  /** 完整类型字面量，如 VARCHAR(255) */
  dataType: string
  typeBase: string
  typeLength?: number
  typeScale?: number
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
  removed: boolean
  snapName: string
  snapColumnsText: string
  snapUnique: boolean
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

export function newEmptyColumn(): DesignColumnDraft {
  return {
    __rowKey: nextDraftKey('col-new'),
    originalName: '',
    name: '',
    dataType: 'VARCHAR(255)',
    typeBase: 'VARCHAR',
    typeLength: 255,
    nullable: true,
    defaultExpr: '',
    primaryKey: false,
    autoIncrement: false,
    comment: '',
    removed: false,
  }
}

export function newEmptyIndex(): DesignIndexDraft {
  return {
    __rowKey: nextDraftKey('idx-new'),
    originalName: '',
    name: '',
    columnsText: '',
    unique: false,
    primary: false,
    removed: false,
    snapName: '',
    snapColumnsText: '',
    snapUnique: false,
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

/** 解析类型字符串，如 VARCHAR(255) → { base:'VARCHAR', length:255 } */
export function parseDataType(raw: string): ParsedDataType {
  const trimmed = raw.trim().toUpperCase()
  const m = trimmed.match(/^([A-Z ]+?)\s*\((\d+)(?:,\s*(\d+))?\)$/)
  if (!m) return { base: trimmed, raw }
  const base = m[1].trim()
  const first = parseInt(m[2], 10)
  const second = m[3] != null ? parseInt(m[3], 10) : undefined
  if (second !== undefined) {
    return { base, precision: first, scale: second, raw }
  }
  return { base, length: first, raw }
}

export function buildDataType(base: string, length?: number, scale?: number): string {
  const opt = MYSQL_BASE_TYPE_OPTIONS.find((o) => o.base.toUpperCase() === base.toUpperCase())
  if (!opt) return base
  if (opt.kind === 'length' && length != null) return `${base}(${length})`
  if (opt.kind === 'precision' && length != null) {
    if (scale != null) return `${base}(${length},${scale})`
    return `${base}(${length})`
  }
  return base
}

export function splitDataTypeFields(raw: string): {
  dataType: string
  typeBase: string
  typeLength?: number
  typeScale?: number
} {
  const p = parseDataType(raw)
  return {
    dataType: raw,
    typeBase: p.base,
    typeLength: p.length ?? p.precision,
    typeScale: p.scale,
  }
}

export function parseColumnList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function columnsEqual(a: DesignColumnDraft, b: DesignColumnDraft): boolean {
  return (
    a.name === b.name &&
    a.dataType === b.dataType &&
    a.nullable === b.nullable &&
    a.defaultExpr === b.defaultExpr &&
    a.comment === b.comment &&
    a.autoIncrement === b.autoIncrement &&
    a.primaryKey === b.primaryKey
  )
}
