/** ClickHouse 表设计器草稿、类型向导与引擎参数。 */

/**
 * 类型参数形态：
 * - none：无参
 * - length：FixedString(N) → typeLength
 * - precision：DateTime64(P) → typeLength 表示精度
 * - scale：Decimal32/64/128/256(S) → typeScale
 * - decimal：Decimal(P, S) → typeLength + typeScale
 * - array：Array(T) → typeInner
 * - map：Map(K, V) → typeInner（"K, V"）
 * - enum：Enum8/16(...) → enumValues
 * - nested：Nested(...) → typeInner（列定义原文）
 * - aggregate：SimpleAggregateFunction / AggregateFunction → typeInner
 */
export type ClickHouseTypeParamKind =
  | 'none'
  | 'length'
  | 'precision'
  | 'scale'
  | 'decimal'
  | 'array'
  | 'map'
  | 'enum'
  | 'nested'
  | 'aggregate'

export interface ClickHouseBaseTypeOption {
  base: string
  kind: ClickHouseTypeParamKind
  defaultLength?: number
  defaultPrecision?: number
  defaultScale?: number
  defaultInner?: string
  defaultEnumValues?: string
}

export interface DesignColumnDraft {
  __rowKey: string
  originalName: string
  name: string
  /** 完整类型字面量 */
  dataType: string
  typeBase: string
  /** FixedString 长度 / DateTime64 精度 / Decimal 精度 P */
  typeLength?: number
  /** Decimal 标度 S */
  typeScale?: number
  /** Array 元素、Map 的 "K, V"、Nested/Aggregate 参数 */
  typeInner: string
  /** Enum8/16 括号内原文，如 'open' = 1, 'close' = 2 */
  enumValues: string
  nullable: boolean
  lowCardinality: boolean
  defaultExpr: string
  comment: string
  codec: string
  removed: boolean
}

export interface DesignIndexDraft {
  __rowKey: string
  originalName: string
  name: string
  expression: string
  type: string
  granularity: number
  removed: boolean
}

export type EngineParamKind = 'none' | 'version' | 'sign' | 'sign_version' | 'columns' | 'config'

export interface EngineOption {
  base: string
  paramKind: EngineParamKind
  paramHint?: string
}

let draftSeq = 0

export function nextDraftKey(prefix: string): string {
  draftSeq += 1
  return `${prefix}-${Date.now()}-${draftSeq}`
}

export const CLICKHOUSE_BASE_TYPE_OPTIONS: ClickHouseBaseTypeOption[] = [
  // 整数
  { base: 'UInt8', kind: 'none' },
  { base: 'UInt16', kind: 'none' },
  { base: 'UInt32', kind: 'none' },
  { base: 'UInt64', kind: 'none' },
  { base: 'UInt128', kind: 'none' },
  { base: 'UInt256', kind: 'none' },
  { base: 'Int8', kind: 'none' },
  { base: 'Int16', kind: 'none' },
  { base: 'Int32', kind: 'none' },
  { base: 'Int64', kind: 'none' },
  { base: 'Int128', kind: 'none' },
  { base: 'Int256', kind: 'none' },
  // 浮点 / 定点
  { base: 'Float32', kind: 'none' },
  { base: 'Float64', kind: 'none' },
  { base: 'Decimal', kind: 'decimal', defaultPrecision: 18, defaultScale: 2 },
  { base: 'Decimal32', kind: 'scale', defaultScale: 2 },
  { base: 'Decimal64', kind: 'scale', defaultScale: 2 },
  { base: 'Decimal128', kind: 'scale', defaultScale: 2 },
  { base: 'Decimal256', kind: 'scale', defaultScale: 2 },
  // 字符串 / 枚举
  { base: 'String', kind: 'none' },
  { base: 'FixedString', kind: 'length', defaultLength: 16 },
  { base: 'Enum8', kind: 'enum', defaultEnumValues: "'open' = 1, 'close' = 2" },
  { base: 'Enum16', kind: 'enum', defaultEnumValues: "'a' = 1, 'b' = 2" },
  // 时间
  { base: 'Date', kind: 'none' },
  { base: 'Date32', kind: 'none' },
  { base: 'DateTime', kind: 'none' },
  { base: 'DateTime64', kind: 'precision', defaultPrecision: 3 },
  // 其它标量
  { base: 'UUID', kind: 'none' },
  { base: 'Bool', kind: 'none' },
  { base: 'IPv4', kind: 'none' },
  { base: 'IPv6', kind: 'none' },
  { base: 'JSON', kind: 'none' },
  // 复合 / 特殊
  { base: 'Array', kind: 'array', defaultInner: 'String' },
  { base: 'Map', kind: 'map', defaultInner: 'String, String' },
  { base: 'Tuple', kind: 'nested', defaultInner: 'String, UInt64' },
  { base: 'Nested', kind: 'nested', defaultInner: 'id UInt64, name String' },
  {
    base: 'SimpleAggregateFunction',
    kind: 'aggregate',
    defaultInner: 'sum, UInt64',
  },
  {
    base: 'AggregateFunction',
    kind: 'aggregate',
    defaultInner: 'uniq, String',
  },
]

/** @deprecated 兼容旧引用；请用 CLICKHOUSE_BASE_TYPE_OPTIONS */
export const CLICKHOUSE_TYPE_OPTIONS = [
  'UInt8', 'UInt16', 'UInt32', 'UInt64',
  'Int8', 'Int16', 'Int32', 'Int64',
  'Float32', 'Float64',
  'String', 'FixedString(16)',
  'Date', 'DateTime', 'DateTime64(3)',
  'UUID', 'Bool',
  'Nullable(String)', 'Nullable(Int64)', 'Nullable(DateTime)',
] as const

export const CLICKHOUSE_ENGINE_OPTIONS: EngineOption[] = [
  { base: 'MergeTree', paramKind: 'none' },
  { base: 'ReplacingMergeTree', paramKind: 'version', paramHint: 'ver' },
  { base: 'SummingMergeTree', paramKind: 'columns', paramHint: 'col1, col2' },
  { base: 'AggregatingMergeTree', paramKind: 'none' },
  { base: 'CollapsingMergeTree', paramKind: 'sign', paramHint: 'sign' },
  { base: 'VersionedCollapsingMergeTree', paramKind: 'sign_version', paramHint: 'sign, version' },
  { base: 'GraphiteMergeTree', paramKind: 'config', paramHint: "'config_section'" },
  { base: 'TinyLog', paramKind: 'none' },
  { base: 'StripeLog', paramKind: 'none' },
  { base: 'Log', paramKind: 'none' },
  { base: 'Memory', paramKind: 'none' },
]

export const CLICKHOUSE_PARTITION_PRESETS = [
  'toYYYYMM(dt)',
  'toYYYYMMDD(dt)',
  'toYear(dt)',
  'toDate(dt)',
] as const

export const CLICKHOUSE_INDEX_TYPE_OPTIONS = [
  'minmax',
  'set',
  'bloom_filter',
  'ngrambf_v1',
  'tokenbf_v1',
] as const

export const CLICKHOUSE_CODEC_OPTIONS = [
  'LZ4',
  'LZ4HC',
  'ZSTD',
  'ZSTD(3)',
  'Delta, LZ4',
  'DoubleDelta, LZ4',
  'Gorilla, LZ4',
  'T64, LZ4',
] as const

/** Array / Map 元素类型常用候选。 */
export const CLICKHOUSE_INNER_TYPE_PRESETS = [
  'String',
  'UInt8',
  'UInt32',
  'UInt64',
  'Int32',
  'Int64',
  'Float64',
  'Date',
  'DateTime',
  'UUID',
  'Bool',
] as const

export function resolveBaseTypeOption(base: string): ClickHouseBaseTypeOption | undefined {
  const key = base.trim()
  return CLICKHOUSE_BASE_TYPE_OPTIONS.find((o) => o.base.toLowerCase() === key.toLowerCase())
}

export function dataTypeParamKind(base: string): ClickHouseTypeParamKind {
  return resolveBaseTypeOption(base)?.kind ?? 'none'
}

export function defaultParamsForBase(base: string): Pick<
  DesignColumnDraft,
  'typeLength' | 'typeScale' | 'typeInner' | 'enumValues'
> {
  const opt = resolveBaseTypeOption(base)
  if (!opt) return { typeInner: '', enumValues: '' }
  if (opt.kind === 'length') {
    return { typeLength: opt.defaultLength ?? 16, typeInner: '', enumValues: '' }
  }
  if (opt.kind === 'precision') {
    return { typeLength: opt.defaultPrecision ?? 3, typeInner: '', enumValues: '' }
  }
  if (opt.kind === 'scale') {
    return { typeScale: opt.defaultScale ?? 2, typeInner: '', enumValues: '' }
  }
  if (opt.kind === 'decimal') {
    return {
      typeLength: opt.defaultPrecision ?? 18,
      typeScale: opt.defaultScale ?? 2,
      typeInner: '',
      enumValues: '',
    }
  }
  if (opt.kind === 'array' || opt.kind === 'map' || opt.kind === 'nested' || opt.kind === 'aggregate') {
    return { typeInner: opt.defaultInner ?? '', enumValues: '' }
  }
  if (opt.kind === 'enum') {
    return { typeInner: '', enumValues: opt.defaultEnumValues ?? "'a' = 1" }
  }
  return { typeInner: '', enumValues: '' }
}

/** 取最外层 TypeName(...) 的括号内容（支持嵌套括号）。 */
export function splitOuterType(raw: string): { name: string; args: string } | null {
  const s = raw.trim()
  const open = s.indexOf('(')
  if (open <= 0 || !s.endsWith(')')) return null
  const name = s.slice(0, open).trim()
  if (!/^[A-Za-z_][\w]*$/.test(name)) return null
  return { name, args: s.slice(open + 1, -1).trim() }
}

/** 解析完整类型 → 向导字段。 */
export function parseDataType(raw: string): {
  typeBase: string
  typeLength?: number
  typeScale?: number
  typeInner: string
  enumValues: string
  nullable: boolean
  lowCardinality: boolean
} {
  let s = raw.trim()
  let nullable = false
  let lowCardinality = false

  // 由外到内剥 LowCardinality / Nullable（仅一层一层剥已知包装）
  for (let i = 0; i < 4; i++) {
    const outer = splitOuterType(s)
    if (!outer) break
    const n = outer.name.toLowerCase()
    if (n === 'lowcardinality') {
      lowCardinality = true
      s = outer.args
      continue
    }
    if (n === 'nullable') {
      nullable = true
      s = outer.args
      continue
    }
    break
  }

  const outer = splitOuterType(s)
  if (outer) {
    const name = outer.name
    const args = outer.args
    const lower = name.toLowerCase()

    if (lower === 'fixedstring') {
      const n = Number(args)
      return {
        typeBase: 'FixedString',
        typeLength: Number.isFinite(n) ? n : 16,
        typeInner: '',
        enumValues: '',
        nullable,
        lowCardinality,
      }
    }
    if (lower === 'datetime64') {
      const m = /^(\d+)/.exec(args)
      return {
        typeBase: 'DateTime64',
        typeLength: m ? Number(m[1]) : 3,
        typeInner: '',
        enumValues: '',
        nullable,
        lowCardinality,
      }
    }
    if (lower === 'decimal') {
      const m = /^(\d+)\s*,\s*(\d+)$/.exec(args)
      if (m) {
        return {
          typeBase: 'Decimal',
          typeLength: Number(m[1]),
          typeScale: Number(m[2]),
          typeInner: '',
          enumValues: '',
          nullable,
          lowCardinality,
        }
      }
      const pOnly = /^(\d+)$/.exec(args)
      if (pOnly) {
        return {
          typeBase: 'Decimal',
          typeLength: Number(pOnly[1]),
          typeScale: 0,
          typeInner: '',
          enumValues: '',
          nullable,
          lowCardinality,
        }
      }
    }
    const decimalSized = /^decimal(32|64|128|256)$/i.exec(name)
    if (decimalSized) {
      const n = Number(args)
      return {
        typeBase: `Decimal${decimalSized[1]}`,
        typeScale: Number.isFinite(n) ? n : 2,
        typeInner: '',
        enumValues: '',
        nullable,
        lowCardinality,
      }
    }
    if (lower === 'enum8' || lower === 'enum16') {
      return {
        typeBase: lower === 'enum8' ? 'Enum8' : 'Enum16',
        typeInner: '',
        enumValues: args,
        nullable,
        lowCardinality,
      }
    }
    if (lower === 'array') {
      return {
        typeBase: 'Array',
        typeInner: args || 'String',
        enumValues: '',
        nullable,
        lowCardinality,
      }
    }
    if (lower === 'map') {
      return {
        typeBase: 'Map',
        typeInner: args || 'String, String',
        enumValues: '',
        nullable,
        lowCardinality,
      }
    }
    if (lower === 'tuple' || lower === 'nested') {
      return {
        typeBase: lower === 'tuple' ? 'Tuple' : 'Nested',
        typeInner: args,
        enumValues: '',
        nullable,
        lowCardinality,
      }
    }
    if (lower === 'simpleaggregatefunction' || lower === 'aggregatefunction') {
      return {
        typeBase: lower === 'simpleaggregatefunction'
          ? 'SimpleAggregateFunction'
          : 'AggregateFunction',
        typeInner: args,
        enumValues: '',
        nullable,
        lowCardinality,
      }
    }
  }

  const known = resolveBaseTypeOption(s)
  if (known) {
    return {
      typeBase: known.base,
      ...defaultParamsForBase(known.base),
      nullable,
      lowCardinality,
    }
  }
  // 未知类型：整段当作 typeBase，允许 creatable 原样保留
  return {
    typeBase: s || 'String',
    typeInner: '',
    enumValues: '',
    nullable,
    lowCardinality,
  }
}

export function syncColumnDataType(col: Pick<
  DesignColumnDraft,
  'typeBase' | 'typeLength' | 'typeScale' | 'typeInner' | 'enumValues' | 'nullable' | 'lowCardinality'
>): string {
  const base = col.typeBase.trim() || 'String'
  const kind = dataTypeParamKind(base)
  const opt = resolveBaseTypeOption(base)
  let inner = base

  if (kind === 'length') {
    const n = col.typeLength ?? opt?.defaultLength ?? 16
    inner = `FixedString(${n})`
  } else if (kind === 'precision') {
    const n = col.typeLength ?? opt?.defaultPrecision ?? 3
    inner = `DateTime64(${n})`
  } else if (kind === 'scale') {
    const s = col.typeScale ?? opt?.defaultScale ?? 2
    inner = `${base}(${s})`
  } else if (kind === 'decimal') {
    const p = col.typeLength ?? opt?.defaultPrecision ?? 18
    const sc = col.typeScale ?? opt?.defaultScale ?? 2
    inner = `Decimal(${p}, ${sc})`
  } else if (kind === 'enum') {
    const vals = col.enumValues.trim() || opt?.defaultEnumValues || "'a' = 1"
    inner = `${base}(${vals})`
  } else if (kind === 'array') {
    const el = col.typeInner.trim() || opt?.defaultInner || 'String'
    inner = `Array(${el})`
  } else if (kind === 'map') {
    const kv = col.typeInner.trim() || opt?.defaultInner || 'String, String'
    inner = `Map(${kv})`
  } else if (kind === 'nested') {
    const args = col.typeInner.trim() || opt?.defaultInner || ''
    inner = args ? `${base}(${args})` : base
  } else if (kind === 'aggregate') {
    const args = col.typeInner.trim() || opt?.defaultInner || ''
    inner = args ? `${base}(${args})` : base
  } else if (base.includes('(')) {
    // creatable 手输完整类型
    inner = base
  }

  // Array / Nested / AggregateFunction 一般不包 Nullable；仍允许用户勾选
  if (col.nullable) inner = `Nullable(${inner})`
  if (col.lowCardinality) inner = `LowCardinality(${inner})`
  return inner
}

export function columnFromParts(
  partial: Partial<DesignColumnDraft> & Pick<DesignColumnDraft, 'name' | 'typeBase'>,
): DesignColumnDraft {
  const defaults = defaultParamsForBase(partial.typeBase)
  const draft: DesignColumnDraft = {
    __rowKey: partial.__rowKey ?? nextDraftKey('col'),
    originalName: partial.originalName ?? '',
    name: partial.name,
    typeBase: partial.typeBase,
    typeLength: partial.typeLength ?? defaults.typeLength,
    typeScale: partial.typeScale ?? defaults.typeScale,
    typeInner: partial.typeInner ?? defaults.typeInner ?? '',
    enumValues: partial.enumValues ?? defaults.enumValues ?? '',
    nullable: partial.nullable ?? false,
    lowCardinality: partial.lowCardinality ?? false,
    defaultExpr: partial.defaultExpr ?? '',
    comment: partial.comment ?? '',
    codec: partial.codec ?? '',
    removed: partial.removed ?? false,
    dataType: '',
  }
  draft.dataType = syncColumnDataType(draft)
  return draft
}

export function newEmptyColumn(): DesignColumnDraft {
  return columnFromParts({ name: '', typeBase: 'String' })
}

export function newEmptyIndex(): DesignIndexDraft {
  return {
    __rowKey: nextDraftKey('idx'),
    originalName: '',
    name: '',
    expression: '',
    type: 'minmax',
    granularity: 1,
    removed: false,
  }
}

/** 分析表默认模板：时间列在前，ORDER BY (dt, id)。 */
export function defaultCreateTableColumns(): DesignColumnDraft[] {
  return [
    columnFromParts({ name: 'dt', typeBase: 'DateTime', comment: '' }),
    columnFromParts({ name: 'id', typeBase: 'UInt64' }),
  ]
}

export function resolveEngineOption(base: string): EngineOption | undefined {
  const key = base.trim()
  return CLICKHOUSE_ENGINE_OPTIONS.find((o) => o.base.toLowerCase() === key.toLowerCase())
}

export function parseEngine(raw: string): { base: string; args: string } {
  const s = raw.trim()
  if (!s) return { base: 'MergeTree', args: '' }
  const m = /^([A-Za-z_]\w*)\s*\((.*)\)\s*$/.exec(s)
  if (m) return { base: m[1], args: m[2].trim() }
  return { base: s, args: '' }
}

export function composeEngine(base: string, args: string): string {
  const b = base.trim() || 'MergeTree'
  const a = args.trim()
  const opt = resolveEngineOption(b)
  if (!opt || opt.paramKind === 'none') {
    return a ? `${b}(${a})` : b
  }
  if (!a) return b
  return `${b}(${a})`
}

/** 将多列 / 表达式拼成 ORDER BY / PRIMARY KEY 字面量。 */
export function composeKeyExpression(parts: string[]): string {
  const list = parts.map((p) => p.trim()).filter(Boolean)
  if (list.length === 0) return ''
  if (list.length === 1) {
    const one = list[0]
    if (one.startsWith('(') || one.includes(',')) return one
    return one
  }
  return `(${list.join(', ')})`
}

/** 解析 ORDER BY / PRIMARY KEY 为可选列名列表（复杂表达式则原样单元素）。 */
export function parseKeyExpression(raw: string): string[] {
  let s = raw.trim()
  if (!s) return []
  if (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1).trim()
  }
  if (!/[()]/.test(s)) {
    return s.split(',').map((x) => x.trim()).filter(Boolean)
  }
  return [raw.trim()]
}

export function joinColumnList(names: string[]): string {
  return names.map((n) => n.trim()).filter(Boolean).join(', ')
}

export function splitColumnList(text: string): string[] {
  return text.split(',').map((x) => x.trim()).filter(Boolean)
}
