/** 将 PG / VastBase（含 Oracle 兼容）列类型映射为 RsTable valueType。 */

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
  'bit',
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
  'json',
  'jsonb',
  'xml',
  'bytea',
  'clob',
  'nclob',
  'blob',
  'raw',
  'long',
  'long raw',
  'bfile',
  'citext',
  'tsvector',
  'tsquery',
])

/** SQL dataType → 表格单元格 valueType。 */
export function resolveSqlValueType(dataType?: string | null): GridCellValueType {
  const t = normalizeSqlDataType(dataType)
  if (!t) return 'text'

  if (BOOLEAN_TYPES.has(t)) return 'boolean'
  if (DATE_TYPES.has(t)) return 'date'
  if (DATETIME_TYPES.has(t)) return 'datetime'
  if (NUMBER_TYPES.has(t)) return 'number'
  if (TEXTAREA_TYPES.has(t)) return 'textarea'

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
  if (t.includes('json') || t.includes('clob') || t.includes('blob') || t === 'bytea') {
    return 'textarea'
  }
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
