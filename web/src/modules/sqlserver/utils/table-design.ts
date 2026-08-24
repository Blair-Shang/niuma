/**
 * SQL Server 表设计器草稿类型与工具函数。
 */

export type DataTypeParamKind = 'none' | 'length' | 'precision'

export interface SqlServerBaseTypeOption {
  base: string
  kind: DataTypeParamKind
  defaultLength?: number
  defaultPrecision?: number
  defaultScale?: number
}

export const SQLSERVER_BASE_TYPE_OPTIONS: SqlServerBaseTypeOption[] = [
  { base: 'INT', kind: 'none' },
  { base: 'BIGINT', kind: 'none' },
  { base: 'SMALLINT', kind: 'none' },
  { base: 'TINYINT', kind: 'none' },
  { base: 'BIT', kind: 'none' },
  { base: 'DECIMAL', kind: 'precision', defaultPrecision: 18, defaultScale: 2 },
  { base: 'NUMERIC', kind: 'precision', defaultPrecision: 18, defaultScale: 2 },
  { base: 'FLOAT', kind: 'none' },
  { base: 'REAL', kind: 'none' },
  { base: 'MONEY', kind: 'none' },
  { base: 'NVARCHAR', kind: 'length', defaultLength: 50 },
  { base: 'VARCHAR', kind: 'length', defaultLength: 50 },
  { base: 'NCHAR', kind: 'length', defaultLength: 1 },
  { base: 'CHAR', kind: 'length', defaultLength: 1 },
  { base: 'NVARCHAR(MAX)', kind: 'none' },
  { base: 'VARCHAR(MAX)', kind: 'none' },
  { base: 'DATE', kind: 'none' },
  { base: 'TIME', kind: 'none' },
  { base: 'DATETIME2', kind: 'none' },
  { base: 'DATETIME', kind: 'none' },
  { base: 'DATETIMEOFFSET', kind: 'none' },
  { base: 'UNIQUEIDENTIFIER', kind: 'none' },
  { base: 'VARBINARY(MAX)', kind: 'none' },
  { base: 'XML', kind: 'none' },
]

/** @deprecated 使用 SQLSERVER_BASE_TYPE_OPTIONS */
export const SQLSERVER_BASE_TYPES: string[] = SQLSERVER_BASE_TYPE_OPTIONS.map((o) => o.base)

export const SQLSERVER_FK_ACTIONS = ['NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT'] as const
export type SqlServerFkAction = (typeof SQLSERVER_FK_ACTIONS)[number]

/** SQL Server 索引组织方式（CREATE [CLUSTERED|NONCLUSTERED] INDEX）。 */
export const SQLSERVER_INDEX_METHODS = ['NONCLUSTERED', 'CLUSTERED'] as const
export type SqlServerIndexMethod = (typeof SQLSERVER_INDEX_METHODS)[number]

export function normalizeIndexMethod(raw: string): SqlServerIndexMethod {
  const m = raw.trim().toUpperCase()
  if (m === 'CLUSTERED') return 'CLUSTERED'
  return 'NONCLUSTERED'
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
  /** NONCLUSTERED / CLUSTERED */
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

export function resolveBaseTypeOption(base: string): SqlServerBaseTypeOption | undefined {
  const upper = base.trim().toUpperCase()
  return SQLSERVER_BASE_TYPE_OPTIONS.find((o) => o.base.toUpperCase() === upper)
}

export function dataTypeParamKind(base: string): DataTypeParamKind {
  return resolveBaseTypeOption(base)?.kind ?? 'none'
}

/** SQL Server DECIMAL / NUMERIC 精度上限（引擎硬限制）。 */
export const SQLSERVER_DECIMAL_MAX_PRECISION = 38

function isValidDecimalPrecision(n: number | undefined): n is number {
  return n != null && Number.isFinite(n) && n >= 1 && n <= SQLSERVER_DECIMAL_MAX_PRECISION
}

type DesignColumnTypeParamKey = 'typeBase' | 'typeLength' | 'typeScale'
type DesignColumnTypeFieldKey = DesignColumnTypeParamKey | 'dataType'
type DesignColumnLengthScaleKey = 'typeLength' | 'typeScale'
type DesignColumnTypeParams = Pick<DesignColumnDraft, DesignColumnTypeParamKey>
type DesignColumnTypeFields = Pick<DesignColumnDraft, DesignColumnTypeFieldKey>
type DesignColumnLengthScale = Pick<DesignColumnDraft, DesignColumnLengthScaleKey>

/**
 * 切换基底类型时按 kind 重置长度/精度。
 * NVARCHAR(50) → DECIMAL 不能沿用 50，否则会生成 DECIMAL(50,2) 被引擎拒绝。
 */
export function applyColumnTypeBase(
  col: DesignColumnTypeParams,
  nextBaseRaw: string,
): DesignColumnTypeFields {
  const typeBase = nextBaseRaw.trim().toUpperCase() || col.typeBase
  const prevKind = dataTypeParamKind(col.typeBase)
  const kind = dataTypeParamKind(typeBase)
  const opt = resolveBaseTypeOption(typeBase)
  let typeLength = col.typeLength
  let typeScale = col.typeScale

  if (kind === 'none') {
    typeLength = undefined
    typeScale = undefined
  } else if (kind === 'length') {
    typeScale = undefined
    if (prevKind !== 'length' || typeLength == null) {
      typeLength = opt?.defaultLength
    }
  } else {
    const reuse = prevKind === 'precision' && isValidDecimalPrecision(typeLength)
    if (!reuse) {
      typeLength = opt?.defaultPrecision ?? 18
      typeScale = opt?.defaultScale ?? 2
    } else if (typeScale == null) {
      typeScale = opt?.defaultScale ?? 2
    }
    if (typeLength != null && typeScale != null && typeScale > typeLength) {
      typeScale = typeLength
    }
  }

  const next = { typeBase: opt?.base ?? typeBase, typeLength, typeScale }
  return { ...next, dataType: syncColumnDataType(next) }
}

/** 精度列把长度/小数位限制在引擎允许范围内。 */
export function clampColumnTypeParams(
  col: DesignColumnTypeParams,
): DesignColumnLengthScale {
  if (dataTypeParamKind(col.typeBase) !== 'precision') {
    return { typeLength: col.typeLength, typeScale: col.typeScale }
  }
  let typeLength = col.typeLength
  let typeScale = col.typeScale
  if (typeLength != null && Number.isFinite(typeLength)) {
    typeLength = Math.min(
      SQLSERVER_DECIMAL_MAX_PRECISION,
      Math.max(1, Math.floor(typeLength)),
    )
  }
  if (typeScale != null && Number.isFinite(typeScale)) {
    const maxScale = typeLength ?? SQLSERVER_DECIMAL_MAX_PRECISION
    typeScale = Math.min(maxScale, Math.max(0, Math.floor(typeScale)))
  }
  return { typeLength, typeScale }
}

export function newEmptyColumn(): DesignColumnDraft {
  return {
    __rowKey: nextDraftKey('col-new'),
    originalName: '',
    name: '',
    dataType: 'NVARCHAR(50)',
    typeBase: 'NVARCHAR',
    typeLength: 50,
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
    method: 'NONCLUSTERED',
    removed: false,
    snapName: '',
    snapColumnsText: '',
    snapUnique: false,
    snapMethod: 'NONCLUSTERED',
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
const SQLSERVER_DEFAULT_BARE_RE =
  /^(NULL|TRUE|FALSE|CURRENT_(?:TIMESTAMP|DATE|TIME|USER)(?:\(\d*\))?|LOCALTIME(?:\(\d*\))?|LOCALTIMESTAMP(?:\(\d*\))?|UTC_TIMESTAMP(?:\(\d*\))?|NOW\(\)|SYSDATE|SYSTIMESTAMP|USER)$/i
const SQLSERVER_DEFAULT_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const SQLSERVER_DEFAULT_HEX_BIT_RE = /^(0x[0-9a-fA-F]+|[xX]'[0-9a-fA-F]*'|[bB]'[01]*')$/

/**
 * 将 UI 中的默认值整理为可写入 DEFAULT 子句的 SQL 片段。
 */
export function formatSqlServerDefaultExpr(expr: string): string {
  const e = expr.trim()
  if (!e) return ''
  if (
    (e.startsWith("'") && e.endsWith("'")) ||
    (e.startsWith('"') && e.endsWith('"'))
  ) {
    return e
  }
  if (SQLSERVER_DEFAULT_BARE_RE.test(e)) return e
  if (SQLSERVER_DEFAULT_NUMBER_RE.test(e)) return e
  if (SQLSERVER_DEFAULT_HEX_BIT_RE.test(e)) return e
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
