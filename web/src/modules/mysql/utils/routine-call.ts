/**
 * MySQL 例程调用 SQL 生成：对齐 Navicat / DBeaver。
 * - 函数：SELECT db.fn(in…)
 * - 过程：SET @out…; CALL db.proc(in…, @out…); SELECT @out…
 */

export type MysqlRoutineParamMode = 'IN' | 'OUT' | 'INOUT'

export interface MysqlRoutineParam {
  ordinal: number
  name: string
  mode: MysqlRoutineParamMode | string
  dataType: string
  dtdIdentifier?: string
  isReturn?: boolean
  /** 参数网格填入的实参（原样写入 SQL；空则用类型默认占位） */
  value?: string
  isNull?: boolean
}

function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

function qualifiedName(database: string, name: string): string {
  return `${quoteIdent(database)}.${quoteIdent(name)}`
}

/** 用户变量名：@p_name / @out_1（仅 [A-Za-z0-9_]）。 */
export function mysqlUserVarName(paramName: string, ordinal: number): string {
  const raw = (paramName || '').trim()
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '')
  if (cleaned) {
    const base = /^[A-Za-z_]/.test(cleaned) ? cleaned : `p_${cleaned}`
    return `@${base}`
  }
  return `@out_${ordinal}`
}

function typeLabel(p: MysqlRoutineParam): string {
  return (p.dtdIdentifier || p.dataType || 'unknown').trim() || 'unknown'
}

function isNumericLike(type: string): boolean {
  return /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|year)$/i.test(
    type.trim(),
  )
}

function isBooleanLike(type: string): boolean {
  return /^(bool|boolean)$/i.test(type.trim())
}

/** 按类型给默认字面量（不含注释）。 */
export function mysqlCallLiteral(p: MysqlRoutineParam): string {
  const t = (p.dataType || '').trim()
  if (isBooleanLike(t)) return 'FALSE'
  if (isNumericLike(t)) return '0'
  if (/^date$/i.test(t)) return `'2020-01-01'`
  if (/^(datetime|timestamp)$/i.test(t)) return `'2020-01-01 00:00:00'`
  if (/^time$/i.test(t)) return `'00:00:00'`
  return `''`
}

/** IN 实参占位：字面量 + 形参注释（用户可改）。 */
export function mysqlCallPlaceholder(p: MysqlRoutineParam): string {
  const label = typeLabel(p)
  const comment = p.name ? ` /* ${p.name} ${label} */` : ` /* ${label} */`
  if (p.isNull) return `NULL${comment}`
  const raw = (p.value ?? '').trim()
  if (raw) return `${raw}${comment}`
  return `${mysqlCallLiteral(p)}${comment}`
}

function normalizeMode(mode: string): MysqlRoutineParamMode {
  const m = mode.trim().toUpperCase()
  if (m === 'OUT' || m === 'INOUT') return m
  return 'IN'
}

/**
 * 根据 information_schema 形参生成可执行调用脚本。
 * OUT/INOUT 使用会话用户变量，并在 CALL 后 SELECT 读出。
 */
function inoutInitLiteral(p: MysqlRoutineParam): string {
  if (p.isNull) return 'NULL'
  const raw = (p.value ?? '').trim()
  if (raw) return raw
  return mysqlCallLiteral(p)
}

export function buildMysqlRoutineCallSql(options: {
  database: string
  name: string
  kind: 'procedure' | 'function'
  parameters: MysqlRoutineParam[]
  returnType?: string
}): string {
  const qn = qualifiedName(options.database, options.name)
  const params = options.parameters
    .filter((p) => !p.isReturn && p.ordinal > 0)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)

  if (options.kind === 'function') {
    const args = params.map((p) => mysqlCallPlaceholder(p)).join(', ')
    const head = options.returnType
      ? `-- Call function ${qn} → ${options.returnType}`
      : `-- Call function ${qn}`
    if (!args) return `${head}\nSELECT ${qn}() AS ${quoteIdent('result')};\n`
    return `${head}\nSELECT ${qn}(${args}) AS ${quoteIdent('result')};\n`
  }

  const lines: string[] = [`-- Call procedure ${qn}`]
  const callArgs: string[] = []
  const outSelects: string[] = []

  for (const p of params) {
    const mode = normalizeMode(p.mode)
    const label = typeLabel(p)
    const display = p.name || `p${p.ordinal}`

    if (mode === 'IN') {
      callArgs.push(mysqlCallPlaceholder(p))
      continue
    }

    const uvar = mysqlUserVarName(p.name, p.ordinal)
    if (mode === 'INOUT') {
      lines.push(`SET ${uvar} = ${inoutInitLiteral(p)}; -- INOUT ${display} ${label}`)
      callArgs.push(uvar)
    } else {
      // OUT：先置 NULL，CALL 后读回
      lines.push(`SET ${uvar} = NULL; -- OUT ${display} ${label}`)
      callArgs.push(uvar)
    }
    outSelects.push(`${uvar} AS ${quoteIdent(display)}`)
  }

  const argList = callArgs.join(', ')
  lines.push(`CALL ${qn}(${argList});`)
  if (outSelects.length > 0) {
    lines.push(`SELECT ${outSelects.join(', ')};`)
  }
  return `${lines.join('\n')}\n`
}
