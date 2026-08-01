/**
 * SQLite 表设计器草稿类型与工具函数。
 * 对齐 sqlite-service DDL；不含 unsigned / enum / comment / engine / charset。
 */

export type DataTypeParamKind = 'none' | 'length'

export interface SqliteBaseTypeOption {
  base: string
  kind: DataTypeParamKind
  defaultLength?: number
}

export const SQLITE_BASE_TYPE_OPTIONS: SqliteBaseTypeOption[] = [
  { base: 'INTEGER', kind: 'none' },
  { base: 'REAL', kind: 'none' },
  { base: 'TEXT', kind: 'none' },
  { base: 'BLOB', kind: 'none' },
  { base: 'NUMERIC', kind: 'none' },
  { base: 'VARCHAR', kind: 'length', defaultLength: 255 },
  { base: 'BOOLEAN', kind: 'none' },
]

export const SQLITE_FK_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'] as const
export type SqliteFkAction = (typeof SQLITE_FK_ACTIONS)[number]

export interface ParsedDataType {
  base: string
  length?: number
  raw: string
}

export type SqliteGeneratedType = '' | 'VIRTUAL' | 'STORED'

export interface DesignColumnDraft {
  __rowKey: string
  originalName: string
  name: string
  /** 完整类型字面量，如 INTEGER、VARCHAR(255) */
  dataType: string
  typeBase: string
  typeLength?: number
  nullable: boolean
  defaultExpr: string
  primaryKey: boolean
  autoIncrement: boolean
  /** 列级 CHECK 表达式（不含 CHECK() 外壳） */
  checkExpr: string
  generatedExpr: string
  generatedType: SqliteGeneratedType
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

export function resolveBaseTypeOption(base: string): SqliteBaseTypeOption | undefined {
  const upper = base.trim().toUpperCase()
  return SQLITE_BASE_TYPE_OPTIONS.find((o) => o.base.toUpperCase() === upper)
}

export function dataTypeParamKind(base: string): DataTypeParamKind {
  return resolveBaseTypeOption(base)?.kind ?? 'none'
}

export function newEmptyColumn(): DesignColumnDraft {
  return {
    __rowKey: nextDraftKey('col-new'),
    originalName: '',
    name: '',
    dataType: 'TEXT',
    typeBase: 'TEXT',
    nullable: true,
    defaultExpr: '',
    primaryKey: false,
    autoIncrement: false,
    checkExpr: '',
    generatedExpr: '',
    generatedType: '',
    removed: false,
  }
}

/** 新建表默认列：id INTEGER PRIMARY KEY AUTOINCREMENT。 */
export function defaultCreateTableColumns(): DesignColumnDraft[] {
  return [
    {
      __rowKey: nextDraftKey('col-id'),
      originalName: '',
      name: 'id',
      dataType: 'INTEGER',
      typeBase: 'INTEGER',
      nullable: false,
      defaultExpr: '',
      primaryKey: true,
      autoIncrement: true,
      checkExpr: '',
      generatedExpr: '',
      generatedType: '',
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

/** 解析类型字符串（支持 VARCHAR(n)）。 */
export function parseDataType(raw: string): ParsedDataType {
  const trimmed = raw.trim()
  const match = trimmed.match(/^([A-Za-z]+)\s*\(\s*(\d+)\s*\)\s*$/i)
  if (match) {
    return { base: match[1].toUpperCase(), length: parseInt(match[2], 10), raw }
  }
  return { base: trimmed.toUpperCase(), raw }
}

export function buildDataType(base: string, opts?: { length?: number }): string {
  const opt = resolveBaseTypeOption(base)
  const kind = opt?.kind ?? 'none'
  const core = base.toUpperCase()
  if (kind === 'length' && opts?.length != null) {
    return `${core}(${opts.length})`
  }
  return core
}

export function syncColumnDataType(
  col: Pick<DesignColumnDraft, 'typeBase' | 'typeLength'>,
): string {
  return buildDataType(col.typeBase, { length: col.typeLength })
}

export function splitDataTypeFields(raw: string): {
  dataType: string
  typeBase: string
  typeLength?: number
} {
  const p = parseDataType(raw)
  return {
    dataType: buildDataType(p.base, { length: p.length }),
    typeBase: p.base,
    typeLength: p.length,
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

const SQLITE_DEFAULT_BARE_RE =
  /^(NULL|TRUE|FALSE|CURRENT_(?:TIMESTAMP|DATE|TIME)(?:\(\))?)$/i
const SQLITE_DEFAULT_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/**
 * 将 UI 默认值整理为 DEFAULT 子句片段（对齐 sqlite-service FormatDefaultExpr）。
 */
export function formatSqliteDefaultExpr(expr: string): string {
  const e = expr.trim()
  if (!e) return ''
  if (
    (e.startsWith("'") && e.endsWith("'")) ||
    (e.startsWith('"') && e.endsWith('"'))
  ) {
    return e
  }
  if (SQLITE_DEFAULT_BARE_RE.test(e)) return e
  if (SQLITE_DEFAULT_NUMBER_RE.test(e)) return e
  if (e.startsWith('(') && e.endsWith(')')) return e
  return `'${e.replace(/'/g, "''")}'`
}

export function columnsEqual(a: DesignColumnDraft, b: DesignColumnDraft): boolean {
  return (
    a.name === b.name &&
    a.dataType === b.dataType &&
    a.nullable === b.nullable &&
    a.defaultExpr === b.defaultExpr &&
    a.autoIncrement === b.autoIncrement &&
    a.primaryKey === b.primaryKey &&
    a.checkExpr === b.checkExpr &&
    a.generatedExpr === b.generatedExpr &&
    a.generatedType === b.generatedType
  )
}
