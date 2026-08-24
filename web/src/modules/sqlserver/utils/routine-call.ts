/**
 * SQL Server 例程调用 T-SQL 生成（对齐 SSMS Execute）。
 * 「复制调用脚本」用本生成器；「运行调用」走 sqlserver.routine.call（过程 TDS RPC / 函数绑定 SELECT），
 * 不要把本脚本交给 query.exec。
 * - 标量函数：SELECT schema.fn(@p…) AS [result]
 * - 表值函数：SELECT * FROM schema.fn(@p…)
 * - 过程：DECLARE OUTPUT/返回值；EXEC @return_value = schema.proc @p = v [, @out = @out OUTPUT]；SELECT 回显
 */

export type SqlServerRoutineParamMode = 'IN' | 'OUTPUT'

export interface SqlServerRoutineParam {
  ordinal: number
  name: string
  mode: SqlServerRoutineParamMode | string
  dataType: string
  dtdIdentifier?: string
  isReturn?: boolean
  hasDefault?: boolean
  isTableType?: boolean
  isCursor?: boolean
  value?: string
  isNull?: boolean
}

function quoteIdent(name: string): string {
  return `[${String(name).replace(/]/g, ']]')}]`
}

function qualifiedName(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

function typeLabel(p: SqlServerRoutineParam): string {
  return (p.dtdIdentifier || p.dataType || 'unknown').trim() || 'unknown'
}

function baseTypeName(type: string): string {
  const t = type.trim()
  const m = /^\[?[A-Za-z_][\w]*\]?(?:\.\[?[A-Za-z_][\w]*\]?)?/.exec(t.replace(/[[\]]/g, ''))
  if (m) {
    const parts = t.replace(/[[\]]/g, '').split('.')
    return (parts[parts.length - 1] || t).replace(/\(.*$/, '')
  }
  const simple = /^([A-Za-z_][\w]*)/.exec(t)
  return simple ? simple[1]! : t
}

function isNumericLike(type: string): boolean {
  return /^(tinyint|smallint|int|integer|bigint|decimal|numeric|money|smallmoney|float|real|bit)$/i.test(
    baseTypeName(type),
  )
}

function isUnicodeString(type: string): boolean {
  return /^(nchar|nvarchar|ntext|sysname)$/i.test(baseTypeName(type))
}

function isAnsiString(type: string): boolean {
  return /^(char|varchar|text|xml)$/i.test(baseTypeName(type))
}

function isBinaryLike(type: string): boolean {
  return /^(binary|varbinary|image|timestamp|rowversion)$/i.test(baseTypeName(type))
}

function isDateLike(type: string): boolean {
  return /^(date|datetime|datetime2|smalldatetime|datetimeoffset|time)$/i.test(baseTypeName(type))
}

function isBareSqlExpr(raw: string): boolean {
  const v = raw.trim()
  if (!v) return false
  if (/^null$/i.test(v)) return true
  if (v.startsWith("'") && v.endsWith("'")) return true
  if (/^N'/i.test(v) && v.endsWith("'")) return true
  if (v.startsWith('(') && v.endsWith(')')) return true
  if (/^0x[0-9A-Fa-f]*$/i.test(v)) return true
  return false
}

/** 将参数网格输入转为 T-SQL 字面量；裸字符串自动加 N'…' / '…'。 */
export function formatSqlServerCallParamLiteral(value: string, type: string): string {
  const v = value.trim()
  if (!v || /^null$/i.test(v)) return 'NULL'
  if (isBareSqlExpr(v)) return v

  const t = type.trim()
  if (isNumericLike(t)) {
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return v
    if (/^(true|yes)$/i.test(v)) return '1'
    if (/^(false|no)$/i.test(v)) return '0'
  }
  if (isBinaryLike(t)) {
    if (/^0x[0-9A-Fa-f]*$/i.test(v)) return v
    return `0x${v.replace(/^0x/i, '')}`
  }
  if (isDateLike(t) && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(v)) {
    const norm = v.includes('T') ? v.replace('T', ' ') : v
    return `'${norm}'`
  }
  const escaped = v.replace(/'/g, "''")
  if (isUnicodeString(t) || !isAnsiString(t)) {
    return `N'${escaped}'`
  }
  return `'${escaped}'`
}

export function sqlserverCallLiteral(p: SqlServerRoutineParam): string {
  const t = typeLabel(p)
  if (p.isTableType) return paramVarName(p)
  if (isNumericLike(t)) return '0'
  if (isBinaryLike(t)) return '0x'
  if (isDateLike(t)) {
    if (/^time$/i.test(baseTypeName(t))) return `'00:00:00'`
    if (/datetimeoffset/i.test(baseTypeName(t))) return `'2020-01-01 00:00:00 +00:00'`
    if (/^date$/i.test(baseTypeName(t))) return `'2020-01-01'`
    return `'2020-01-01 00:00:00'`
  }
  if (isUnicodeString(t) || !isAnsiString(t)) return `N''`
  return `''`
}

function paramDisplayName(p: SqlServerRoutineParam): string {
  const raw = (p.name || '').trim()
  if (raw) return raw
  return `@p${p.ordinal}`
}

/** OUTPUT / 表值参数的局部变量名（保证以 @ 开头）。 */
export function paramVarName(p: SqlServerRoutineParam): string {
  const raw = paramDisplayName(p).replace(/^@+/, '')
  const cleaned = raw.replace(/[^A-Za-z0-9_@#$]/g, '_').replace(/^_+|_+$/g, '')
  const base = cleaned || `p${p.ordinal}`
  const ident = /^[A-Za-z_@#]/.test(base) ? base : `p_${base}`
  return `@${ident.replace(/^@+/, '')}`
}

function declareType(p: SqlServerRoutineParam): string {
  const label = typeLabel(p)
  if (!label || label === 'unknown') return 'nvarchar(max)'
  const sized = /^(n?varchar|n?char|varbinary|binary)\((\d+|max)\)$/i.exec(label)
  if (sized) return label
  if (/^(n?varchar|n?char|varbinary|binary)$/i.test(label)) {
    return `${label}(max)`
  }
  return label
}

function inLiteral(p: SqlServerRoutineParam): string {
  if (p.isNull) return 'NULL'
  const raw = (p.value ?? '').trim()
  if (raw) return formatSqlServerCallParamLiteral(raw, typeLabel(p))
  return sqlserverCallLiteral(p)
}

function namedArg(p: SqlServerRoutineParam, rhs: string, output = false): string {
  const name = paramVarName(p)
  const out = output ? ' OUTPUT' : ''
  return `${name} = ${rhs}${out}`
}

function normalizeMode(mode: string): SqlServerRoutineParamMode {
  const m = mode.trim().toUpperCase()
  if (m === 'OUTPUT' || m === 'OUT' || m === 'INOUT' || m === 'IN/OUT') return 'OUTPUT'
  return 'IN'
}

function callParams(parameters: SqlServerRoutineParam[]): SqlServerRoutineParam[] {
  return parameters
    .filter((p) => !p.isReturn && p.ordinal > 0)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
}

/**
 * 根据 sys.parameters 生成可执行调用脚本。
 * 过程始终捕获返回值；OUTPUT 用同名局部变量并在 EXEC 后 SELECT。
 */
export function buildSqlServerRoutineCallSql(options: {
  schema: string
  name: string
  kind: 'procedure' | 'function'
  parameters: SqlServerRoutineParam[]
  returnType?: string
  isTableValued?: boolean
}): string {
  const schema = options.schema.trim() || 'dbo'
  const qn = qualifiedName(schema, options.name)
  const params = callParams(options.parameters)

  if (options.kind === 'function') {
    const args = params.map((p) => inLiteral(p))
    const argList = args.join(', ')
    const head = options.returnType
      ? `-- Call function ${qn} → ${options.returnType}`
      : `-- Call function ${qn}`
    if (options.isTableValued) {
      return `${head}\nSELECT *\nFROM ${qn}(${argList});\n`
    }
    return `${head}\nSELECT ${qn}(${argList}) AS ${quoteIdent('result')};\n`
  }

  const decls: string[] = ['@return_value int']
  const execArgs: string[] = []
  const selectCols: string[] = [`@return_value AS ${quoteIdent('Return Value')}`]
  const notes: string[] = []

  for (const p of params) {
    const mode = normalizeMode(p.mode)
    const v = paramVarName(p)
    const label = typeLabel(p)

    if (p.isCursor) {
      execArgs.push(namedArg(p, 'NULL'))
      notes.push(`-- Cursor parameter ${v} not bound`)
      continue
    }

    if (p.isTableType) {
      decls.push(`${v} ${declareType(p)}`)
      notes.push(`-- Table-valued parameter ${v} ${label}: INSERT rows before EXEC`)
      execArgs.push(namedArg(p, v))
      continue
    }

    if (mode === 'OUTPUT') {
      const raw = (p.value ?? '').trim()
      if (p.isNull) {
        decls.push(`${v} ${declareType(p)} = NULL`)
      } else if (raw) {
        decls.push(`${v} ${declareType(p)} = ${formatSqlServerCallParamLiteral(raw, label)}`)
      } else {
        decls.push(`${v} ${declareType(p)}`)
      }
      execArgs.push(namedArg(p, v, true))
      selectCols.unshift(`${v} AS ${quoteIdent(paramDisplayName(p))}`)
      continue
    }

    execArgs.push(namedArg(p, inLiteral(p)))
  }

  const lines: string[] = [`SET NOCOUNT ON;`, `-- Execute procedure ${qn}`, ...notes]
  lines.push(`DECLARE ${decls.join(',\n        ')};`)
  const argBlock = execArgs.length === 0 ? '' : `\n    ${execArgs.join(',\n    ')}`
  lines.push(`EXEC @return_value = ${qn}${argBlock};`)
  lines.push(`SELECT ${selectCols.join(',\n       ')};`)
  return `${lines.join('\n')}\n`
}
