/** 将 SQL 列类型映射为 RsTable valueType（MySQL / PG / VastBase / Oracle 兼容）。 */

export type GridCellValueType =
  | 'text'
  | 'number'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'textarea'

/** 去掉精度 / 修饰 / 数组后缀，得到可匹配的基类型名。 */
export function normalizeSqlDataType(dataType?: string | null): string {
  if (!dataType) return ''
  return dataType
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\[\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const BOOLEAN_TYPES = new Set([
  'boolean',
  'bool',
  'plsql_boolean',
])

/** 纯日期（无时间）。Oracle DATE / oradate 含时分秒，归入 datetime。 */
const DATE_TYPES = new Set(['date'])

const DATETIME_TYPES = new Set([
  'timestamp',
  'timestamptz',
  'timestamp without time zone',
  'timestamp with time zone',
  'timestamp with local time zone',
  'datetime',
  'time',
  'timetz',
  'time without time zone',
  'time with time zone',
  'oradate',
  'oratimestamp',
  'oratimestamptz',
  'oratimestampltz',
  'timestampltz',
  'timestampns',
  'smalldatetime',
  'datetime2',
  'datetimeoffset',
  'localtimestamp',
])

const NUMBER_TYPES = new Set([
  'smallint',
  'integer',
  'bigint',
  'int',
  'int2',
  'int4',
  'int8',
  'tinyint',
  'serial',
  'smallserial',
  'bigserial',
  'real',
  'float',
  'float4',
  'float8',
  'double',
  'double precision',
  'numeric',
  'decimal',
  'number',
  'money',
  'oid',
  'binary_float',
  'binary_double',
  'pls_integer',
  'binary_integer',
  'simple_integer',
  'simple_float',
  'simple_double',
])

const TEXTAREA_TYPES = new Set([
  'text',
  'tinytext',
  'mediumtext',
  'longtext',
  'json',
  'jsonb',
  'xml',
  'clob',
  'nclob',
  'citext',
  'tsvector',
  'tsquery',
  'long',
])

/** 二进制大对象：网格只读摘要，禁止当文本行内编辑 */
const BINARY_LOB_TYPES = new Set([
  'blob',
  'tinyblob',
  'mediumblob',
  'longblob',
  'bytea',
  'raw',
  'long raw',
  'bfile',
  'image',
  'binary',
  'varbinary',
])

export interface ResolveSqlValueTypeOptions {
  /** 列显示宽度（TINYINT(1) / BIT(1) 等） */
  length?: number | null
}

/** 是否为二进制 LOB / RAW（非 CLOB 文本）。 */
export function isSqlBinaryLobType(dataType?: string | null): boolean {
  const t = normalizeSqlDataType(dataType)
  if (!t) return false
  if (NUMBER_TYPES.has(t)) return false
  if (BINARY_LOB_TYPES.has(t)) return true
  if (t.includes('blob') || t === 'bytea') return true
  if (t === 'long raw' || t.endsWith(' binary') || t.startsWith('binary(')) return true
  return false
}

/** 长文本 / JSON / XML 等：适合弹窗编辑，不宜单元格内撑开。 */
export function isSqlTextLobType(dataType?: string | null): boolean {
  const t = normalizeSqlDataType(dataType)
  if (!t) return false
  if (isSqlBinaryLobType(t)) return false
  if (TEXTAREA_TYPES.has(t)) return true
  if (t.includes('json') || t.includes('clob') || t.includes('xml')) return true
  if (t.endsWith('text')) return true
  return false
}

/** SQL dataType → 表格单元格 valueType。 */
export function resolveSqlValueType(
  dataType?: string | null,
  options?: ResolveSqlValueTypeOptions,
): GridCellValueType {
  const t = normalizeSqlDataType(dataType)
  if (!t) return 'text'

  // MySQL BOOLEAN = TINYINT(1)；BIT(1) 勾选；BIT(n>1) 为 0x.. 文本
  if (t === 'tinyint' && options?.length === 1) return 'boolean'
  if (t === 'bit') {
    if (options?.length == null || options.length <= 1) return 'boolean'
    return 'text'
  }

  if (BOOLEAN_TYPES.has(t)) return 'boolean'
  if (DATE_TYPES.has(t)) return 'date'
  if (DATETIME_TYPES.has(t)) return 'datetime'
  if (NUMBER_TYPES.has(t)) return 'number'
  if (isSqlBinaryLobType(t)) return 'text'
  if (TEXTAREA_TYPES.has(t) || isSqlTextLobType(t)) return 'textarea'

  // VastBase / Oracle 扩展：名称含关键字时兜底
  if (t.includes('timestamp') || t.startsWith('oratime') || t === 'oradate') {
    return 'datetime'
  }
  if (t.endsWith('date') || t.includes('oradate')) {
    // oradate 已在上方；*date 且非 double precision 等
    if (!t.includes('update') && !t.includes('validate')) return 'date'
  }
  if (
    t.includes('numeric') ||
    t.includes('decimal') ||
    t.includes('float') ||
    t.includes('double') ||
    t.endsWith('int') ||
    t.endsWith('serial')
  ) {
    return 'number'
  }
  if (t.includes('json') || t.includes('clob') || t.includes('xml')) {
    return 'textarea'
  }
  if (t.includes('blob') || t === 'bytea') return 'text'
  if (t.includes('bool') || t === 'bit') return 'boolean'

  // 字符类：varchar / varchar2 / nvarchar2 / char / nchar / bpchar / character varying …
  return 'text'
}

export function alignForValueType(
  valueType: GridCellValueType,
): 'left' | 'center' | 'right' | undefined {
  if (valueType === 'number') return 'right'
  if (valueType === 'boolean') return 'center'
  return undefined
}
