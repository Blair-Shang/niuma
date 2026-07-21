/**
 * 表设计器草稿类型、索引方法与类型向导。
 */
export const VAST_COMMON_DATA_TYPES: string[] = [
  'BIGINT',
  'BIGSERIAL',
  'INTEGER',
  'SERIAL',
  'SMALLINT',
  'NUMERIC(18,2)',
  'REAL',
  'DOUBLE PRECISION',
  'BOOLEAN',
  'TEXT',
  'VARCHAR(255)',
  'CHAR(1)',
  'DATE',
  'TIMESTAMP',
  'TIMESTAMPTZ',
  'TIME',
  'UUID',
  'JSONB',
  'BYTEA',
]

export const VAST_FK_ACTIONS = [
  'NO ACTION',
  'RESTRICT',
  'CASCADE',
  'SET NULL',
  'SET DEFAULT',
] as const

export type VastFkAction = (typeof VAST_FK_ACTIONS)[number]

export const VAST_INDEX_METHODS = [
  'btree',
  'hash',
  'gin',
  'gist',
  'brin',
  'spgist',
] as const

export type VastIndexMethod = (typeof VAST_INDEX_METHODS)[number]

export type DataTypeParamKind = 'none' | 'length' | 'precision'

export interface VastBaseTypeOption {
  base: string
  kind: DataTypeParamKind
  defaultLength?: number
  defaultPrecision?: number
  defaultScale?: number
}

/** 类型向导可选基底类型（不含已拼好的精度字面量）。 */
export const VAST_BASE_TYPE_OPTIONS: VastBaseTypeOption[] = [
  { base: 'BIGINT', kind: 'none' },
  { base: 'BIGSERIAL', kind: 'none' },
  { base: 'INTEGER', kind: 'none' },
  { base: 'SERIAL', kind: 'none' },
  { base: 'SMALLINT', kind: 'none' },
  { base: 'NUMERIC', kind: 'precision', defaultPrecision: 18, defaultScale: 2 },
  { base: 'DECIMAL', kind: 'precision', defaultPrecision: 18, defaultScale: 2 },
  { base: 'REAL', kind: 'none' },
  { base: 'DOUBLE PRECISION', kind: 'none' },
  { base: 'BOOLEAN', kind: 'none' },
  { base: 'TEXT', kind: 'none' },
  /** 空长度 → 无上限 VARCHAR（PG）；有长度 → VARCHAR(n) */
  { base: 'VARCHAR', kind: 'length' },
  { base: 'CHAR', kind: 'length', defaultLength: 1 },
  { base: 'DATE', kind: 'none' },
  /** 可选小数秒精度：TIMESTAMP(p) / TIME(p) */
  { base: 'TIMESTAMP', kind: 'length' },
  { base: 'TIMESTAMPTZ', kind: 'length' },
  { base: 'TIME', kind: 'length' },
  { base: 'UUID', kind: 'none' },
  { base: 'JSONB', kind: 'none' },
  { base: 'JSON', kind: 'none' },
  { base: 'BYTEA', kind: 'none' },
]

export interface ParsedDataType {
  base: string
  length?: number
  precision?: number
  scale?: number
  raw: string
}

export interface DesignColumnDraft {
  __rowKey: string
  /** 原始列名；空表示新增列 / 新建表列 */
  originalName: string
  name: string
  /** 拼好的完整类型字面量（提交 DDL 用） */
  dataType: string
  /** 基底类型，如 VARCHAR / NUMERIC / BIGINT */
  typeBase: string
  /** 长度或精度（NUMERIC 的 precision） */
  typeLength: string
  /** 小数位（NUMERIC scale） */
  typeScale: string
  nullable: boolean
  defaultExpr: string
  primaryKey: boolean
  comment: string
  removed: boolean
}

export interface DesignIndexDraft {
  __rowKey: string
  /** 空表示新建 */
  originalName: string
  name: string
  columnsText: string
  /** 表达式索引键；非空时优先于 columnsText */
  expression: string
  /** 部分索引谓词（不含 WHERE） */
  whereText: string
  unique: boolean
  /** btree/hash/gin/...；空或 btree 表示默认 */
  method: string
  /** 主键索引不可编辑删除 */
  primary: boolean
  removed: boolean
  /** 加载时快照，用于就地编辑 diff */
  snapName: string
  snapColumnsText: string
  snapExpression: string
  snapWhereText: string
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
  snapName: string
  snapColumnsText: string
  snapRefSchema: string
  snapRefTable: string
  snapRefColumnsText: string
  snapOnDelete: string
  snapOnUpdate: string
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

/** 由单元格字段拼出完整 dataType。长度列同时承载 VARCHAR 长度与 NUMERIC 精度。 */
export function syncColumnDataType(draft: {
  typeBase: string
  typeLength: string
  typeScale: string
}): string {
  return composeDataType({
    base: draft.typeBase,
    length: draft.typeLength,
    precision: draft.typeLength,
    scale: draft.typeScale,
  })
}

/** 从完整类型字面量拆出可编辑的类型 / 长度 / 小数位。 */
export function splitDataTypeFields(raw: string): {
  typeBase: string
  typeLength: string
  typeScale: string
  dataType: string
} {
  const parsed = parseDataType(raw)
  const kind = dataTypeParamKind(parsed.base)
  let typeLength = ''
  let typeScale = ''
  if (kind === 'precision' || parsed.precision != null) {
    if (parsed.precision != null) typeLength = String(parsed.precision)
    if (parsed.scale != null) typeScale = String(parsed.scale)
  } else if (kind === 'length' || parsed.length != null) {
    if (parsed.length != null) typeLength = String(parsed.length)
  }
  const fields = { typeBase: parsed.base, typeLength, typeScale }
  return { ...fields, dataType: syncColumnDataType(fields) }
}

function withTypeFields(
  partial: Omit<DesignColumnDraft, 'typeBase' | 'typeLength' | 'typeScale' | 'dataType'> & {
    dataType?: string
    typeBase?: string
    typeLength?: string
    typeScale?: string
  },
): DesignColumnDraft {
  const parts = partial.typeBase
    ? {
        typeBase: partial.typeBase,
        typeLength: partial.typeLength ?? '',
        typeScale: partial.typeScale ?? '',
        dataType: syncColumnDataType({
          typeBase: partial.typeBase,
          typeLength: partial.typeLength ?? '',
          typeScale: partial.typeScale ?? '',
        }),
      }
    : splitDataTypeFields(partial.dataType ?? 'TEXT')
  return {
    ...partial,
    ...parts,
  }
}

/** 新建表默认两列：主键 + 时间戳。 */
export function defaultCreateTableColumns(): DesignColumnDraft[] {
  const ts = Date.now()
  return [
    withTypeFields({
      __rowKey: `new-${ts}-id`,
      originalName: '',
      name: 'id',
      dataType: 'BIGINT',
      nullable: false,
      defaultExpr: '',
      primaryKey: true,
      comment: '',
      removed: false,
    }),
    withTypeFields({
      __rowKey: `new-${ts}-created`,
      originalName: '',
      name: 'created_at',
      dataType: 'TIMESTAMP',
      nullable: false,
      defaultExpr: 'CURRENT_TIMESTAMP',
      primaryKey: false,
      comment: '',
      removed: false,
    }),
  ]
}

export function newEmptyColumn(index = 0): DesignColumnDraft {
  return withTypeFields({
    __rowKey: `new-${Date.now()}-${index}`,
    originalName: '',
    name: `col_${index + 1}`,
    dataType: 'TEXT',
    nullable: true,
    defaultExpr: '',
    primaryKey: false,
    comment: '',
    removed: false,
  })
}

export function newEmptyIndex(index = 0): DesignIndexDraft {
  return {
    __rowKey: `idx-${Date.now()}-${index}`,
    originalName: '',
    name: `idx_col_${index + 1}`,
    columnsText: '',
    expression: '',
    whereText: '',
    unique: false,
    method: 'btree',
    primary: false,
    removed: false,
    snapName: '',
    snapColumnsText: '',
    snapExpression: '',
    snapWhereText: '',
    snapUnique: false,
    snapMethod: 'btree',
  }
}

export function newEmptyForeignKey(index = 0, schema = 'public'): DesignForeignKeyDraft {
  return {
    __rowKey: `fk-${Date.now()}-${index}`,
    originalName: '',
    name: `fk_col_${index + 1}`,
    columnsText: '',
    refSchema: schema,
    refTable: '',
    refColumnsText: '',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    removed: false,
    snapName: '',
    snapColumnsText: '',
    snapRefSchema: schema,
    snapRefTable: '',
    snapRefColumnsText: '',
    snapOnDelete: 'NO ACTION',
    snapOnUpdate: 'NO ACTION',
  }
}

export function newEmptyCheck(index = 0): DesignCheckDraft {
  return {
    __rowKey: `chk-${Date.now()}-${index}`,
    originalName: '',
    name: `chk_${index + 1}`,
    expression: '',
    removed: false,
    snapName: '',
    snapExpression: '',
  }
}

export function parseColumnList(text: string): string[] {
  return text
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function columnsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

export function normalizeFkAction(raw: string): string {
  const a = raw.trim().toUpperCase()
  if (!a) return 'NO ACTION'
  return (VAST_FK_ACTIONS as readonly string[]).includes(a) ? a : 'NO ACTION'
}

export function normalizeIndexMethod(raw: string): string {
  const m = raw.trim().toLowerCase()
  // 空则默认 btree；其余保留（含预设与手输自定义 access method）
  return m || 'btree'
}

function findBaseTypeOption(base: string): VastBaseTypeOption | undefined {
  const upper = base.trim().toUpperCase()
  return VAST_BASE_TYPE_OPTIONS.find((o) => o.base.toUpperCase() === upper)
}

/** 解析基底类型对应的向导元数据（含 length / precision 约束）。 */
export function resolveBaseTypeOption(base: string): VastBaseTypeOption | undefined {
  return findBaseTypeOption(normalizeBaseType(base))
}

/** PG/openGauss 常见类型别名 → 设计器基底类型。 */
const TYPE_ALIASES: Record<string, string> = {
  'CHARACTER VARYING': 'VARCHAR',
  VARCHAR: 'VARCHAR',
  'CHARACTER': 'CHAR',
  CHAR: 'CHAR',
  BPCHAR: 'CHAR',
  INT: 'INTEGER',
  INT2: 'SMALLINT',
  INT4: 'INTEGER',
  INT8: 'BIGINT',
  FLOAT4: 'REAL',
  FLOAT8: 'DOUBLE PRECISION',
  BOOL: 'BOOLEAN',
  DECIMAL: 'DECIMAL',
  NUMERIC: 'NUMERIC',
}

function normalizeBaseType(base: string): string {
  const trimmed = base.trim()
  if (!trimmed) return 'TEXT'
  const upper = trimmed.toUpperCase().replace(/\s+/g, ' ')
  if (TYPE_ALIASES[upper]) return TYPE_ALIASES[upper]!
  const opt = findBaseTypeOption(upper)
  if (opt) return opt.base
  return trimmed
}

/** 解析 VARCHAR(255) / NUMERIC(18,2) / TEXT 等。 */
export function parseDataType(raw: string): ParsedDataType {
  const text = raw.trim()
  if (!text) return { base: 'TEXT', raw: text }
  const m = /^([A-Za-z][A-Za-z0-9_\s]*?)\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/i.exec(text)
  if (!m) {
    return { base: normalizeBaseType(text), raw: text }
  }
  const base = normalizeBaseType(m[1]!.trim())
  const a = Number(m[2])
  const b = m[3] != null ? Number(m[3]) : undefined
  const opt = findBaseTypeOption(base)
  if (opt?.kind === 'precision' || (b != null && opt?.kind !== 'length')) {
    return { base, precision: a, scale: b ?? 0, raw: text }
  }
  return { base, length: a, raw: text }
}

export function dataTypeParamKind(base: string): DataTypeParamKind {
  return findBaseTypeOption(normalizeBaseType(base))?.kind ?? 'none'
}

/** 由基底类型 + 参数拼出 dataType 字面量。 */
export function composeDataType(input: {
  base: string
  length?: number | string
  precision?: number | string
  scale?: number | string
}): string {
  const baseRaw = input.base.trim()
  if (!baseRaw) return 'TEXT'
  const opt = findBaseTypeOption(baseRaw)
  const base = opt?.base ?? baseRaw
  const kind = opt?.kind ?? 'none'
  if (kind === 'length') {
    const n = Number(input.length)
    if (Number.isFinite(n) && n > 0) return `${base}(${Math.floor(n)})`
    // 有默认长度（如 CHAR→1）则补上；VARCHAR / TIME / TIMESTAMP 允许无括号
    if (opt?.defaultLength != null && opt.defaultLength > 0) {
      return `${base}(${opt.defaultLength})`
    }
    return base
  }
  if (kind === 'precision') {
    const p = Number(input.precision)
    const s = Number(input.scale)
    const precision =
      Number.isFinite(p) && p > 0 ? Math.floor(p) : (opt?.defaultPrecision ?? 18)
    let scale = Number.isFinite(s) && s >= 0 ? Math.floor(s) : (opt?.defaultScale ?? 0)
    // PG：scale 不得超过 precision
    if (scale > precision) scale = precision
    return `${base}(${precision},${scale})`
  }
  return base
}
