/**
 * 达梦表设计器草稿类型与工具函数。
 */

export type DataTypeParamKind = 'none' | 'length' | 'precision'

export interface DamengBaseTypeOption {
  base: string
  kind: DataTypeParamKind
  defaultLength?: number
  defaultPrecision?: number
  defaultScale?: number
}

export const DAMENG_BASE_TYPE_OPTIONS: DamengBaseTypeOption[] = [
  { base: 'INT', kind: 'none' },
  { base: 'INTEGER', kind: 'none' },
  { base: 'BIGINT', kind: 'none' },
  { base: 'SMALLINT', kind: 'none' },
  { base: 'TINYINT', kind: 'none' },
  { base: 'FLOAT', kind: 'none' },
  { base: 'DOUBLE', kind: 'none' },
  { base: 'DECIMAL', kind: 'precision', defaultPrecision: 18, defaultScale: 2 },
  { base: 'NUMBER', kind: 'precision', defaultPrecision: 18, defaultScale: 2 },
  { base: 'VARCHAR', kind: 'length', defaultLength: 255 },
  { base: 'VARCHAR2', kind: 'length', defaultLength: 255 },
  { base: 'CHAR', kind: 'length', defaultLength: 1 },
  { base: 'TEXT', kind: 'none' },
  { base: 'CLOB', kind: 'none' },
  { base: 'BLOB', kind: 'none' },
  { base: 'BOOLEAN', kind: 'none' },
  { base: 'BIT', kind: 'none' },
  { base: 'DATE', kind: 'none' },
  { base: 'TIME', kind: 'none' },
  { base: 'TIMESTAMP', kind: 'none' },
  { base: 'DATETIME', kind: 'none' },
]

/** @deprecated 使用 DAMENG_BASE_TYPE_OPTIONS */
export const DAMENG_BASE_TYPES: string[] = DAMENG_BASE_TYPE_OPTIONS.map((o) => o.base)

export const DAMENG_FK_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL'] as const
export type DamengFkAction = (typeof DAMENG_FK_ACTIONS)[number]

/** 达梦索引类型（对应 CREATE [BITMAP|HASH|SPATIAL] INDEX）。 */
export const DAMENG_INDEX_METHODS = ['BTREE', 'BITMAP', 'HASH', 'SPATIAL'] as const
export type DamengIndexMethod = (typeof DAMENG_INDEX_METHODS)[number]

export function normalizeIndexMethod(raw: string): DamengIndexMethod {
  const m = raw.trim().toUpperCase()
  if ((DAMENG_INDEX_METHODS as readonly string[]).includes(m)) {
    return m as DamengIndexMethod
  }
  return 'BTREE'
}

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
  /** 完整类型字面量，如 VARCHAR(255)、BIGINT */
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
  /** BTREE / BITMAP / HASH / SPATIAL */
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
  refSchema: string
  refTable: string
  refColumnsText: string
  onDelete: string
  onUpdate: string
  removed: boolean
}

export interface DesignCheckDraft {
  __rowKey: string
  originalName: string
  name: string
  expression: string
  removed: boolean
  snapName: string
  snapExpression: string
}

let draftCounter = 0
export function nextDraftKey(prefix: string): string {
  return `${prefix}-${++draftCounter}`
}

export function resolveBaseTypeOption(base: string): DamengBaseTypeOption | undefined {
  const upper = base.trim().toUpperCase()
  return DAMENG_BASE_TYPE_OPTIONS.find((o) => o.base.toUpperCase() === upper)
}

export function dataTypeParamKind(base: string): DataTypeParamKind {
  return resolveBaseTypeOption(base)?.kind ?? 'none'
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

/** 新建表默认列：id BIGINT IDENTITY PRIMARY KEY（对齐 Navicat / DBeaver）。 */
export function defaultCreateTableColumns(): DesignColumnDraft[] {
  return [
    {
      __rowKey: nextDraftKey('col-id'),
      originalName: '',
      name: 'id',
      dataType: 'BIGINT',
      typeBase: 'BIGINT',
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

export function newEmptyForeignKey(schema = ''): DesignForeignKeyDraft {
  return {
    __rowKey: nextDraftKey('fk-new'),
    originalName: '',
    name: '',
    columnsText: '',
    refSchema: schema,
    refTable: '',
    refColumnsText: '',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    removed: false,
  }
}

export function newEmptyCheck(index = 0): DesignCheckDraft {
  return {
    __rowKey: nextDraftKey('chk-new'),
    originalName: '',
    name: `chk_${index + 1}`,
    expression: '',
    removed: false,
    snapName: '',
    snapExpression: '',
  }
}

/** 解析达梦类型字符串（长度 / 精度）。 */
export function parseDataType(raw: string): ParsedDataType {
  const trimmed = raw.trim()

  const parenMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/i)
  if (parenMatch) {
    const base = parenMatch[1].toUpperCase()
    const inner = parenMatch[2].trim()
    const nums = inner.match(/^(\d+)(?:,\s*(\d+))?$/)
    if (nums) {
      const first = parseInt(nums[1], 10)
      const second = nums[2] != null ? parseInt(nums[2], 10) : undefined
      if (second !== undefined) {
        return { base, precision: first, scale: second, raw }
      }
      return { base, length: first, raw }
    }
  }

  return { base: trimmed.toUpperCase(), raw }
}

export function buildDataType(
  base: string,
  opts?: {
    length?: number
    scale?: number
  },
): string {
  const opt = resolveBaseTypeOption(base)
  const kind = opt?.kind ?? 'none'
  let core = base.toUpperCase()

  if (kind === 'length' && opts?.length != null) {
    core = `${core}(${opts.length})`
  } else if (kind === 'precision' && opts?.length != null) {
    core =
      opts.scale != null ? `${core}(${opts.length},${opts.scale})` : `${core}(${opts.length})`
  }

  return core
}

export function syncColumnDataType(col: Pick<
  DesignColumnDraft,
  'typeBase' | 'typeLength' | 'typeScale'
>): string {
  return buildDataType(col.typeBase, {
    length: col.typeLength,
    scale: col.typeScale,
  })
}

export function splitDataTypeFields(raw: string): {
  dataType: string
  typeBase: string
  typeLength?: number
  typeScale?: number
} {
  const p = parseDataType(raw)
  return {
    dataType: buildDataType(p.base, {
      length: p.length ?? p.precision,
      scale: p.scale,
    }),
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
const DAMENG_DEFAULT_BARE_RE =
  /^(NULL|TRUE|FALSE|CURRENT_(?:TIMESTAMP|DATE|TIME|USER)(?:\(\d*\))?|LOCALTIME(?:\(\d*\))?|LOCALTIMESTAMP(?:\(\d*\))?|UTC_TIMESTAMP(?:\(\d*\))?|NOW\(\)|SYSDATE|SYSTIMESTAMP|USER)$/i
const DAMENG_DEFAULT_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const DAMENG_DEFAULT_HEX_BIT_RE = /^(0x[0-9a-fA-F]+|[xX]'[0-9a-fA-F]*'|[bB]'[01]*')$/

/**
 * 将 UI 中的默认值整理为可写入 DEFAULT 子句的 SQL 片段。
 */
export function formatDamengDefaultExpr(expr: string): string {
  const e = expr.trim()
  if (!e) return ''
  if (
    (e.startsWith("'") && e.endsWith("'")) ||
    (e.startsWith('"') && e.endsWith('"'))
  ) {
    return e
  }
  if (DAMENG_DEFAULT_BARE_RE.test(e)) return e
  if (DAMENG_DEFAULT_NUMBER_RE.test(e)) return e
  if (DAMENG_DEFAULT_HEX_BIT_RE.test(e)) return e
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
    a.primaryKey === b.primaryKey
  )
}
