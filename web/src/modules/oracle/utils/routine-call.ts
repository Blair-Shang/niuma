/**
 * Oracle 例程调用 SQL 生成（查询面板「打开调用脚本」/「复制调用脚本」；不做 DDL）。
 * - 函数：SELECT schema.fn(in…) AS result FROM DUAL
 * - 过程：匿名块 + 局部变量接 OUT/INOUT；OUT 经 DBMS_OUTPUT 打印（无 GTT）
 * 树菜单「调用」与面板「运行调用」走 oracle.routine.call（ODPI bind OUT），不依赖本脚本。
 * 参数网格所见即所得：未加引号的字符串值由序列化自动加单引号。
 */

export type OracleRoutineParamMode = 'IN' | 'OUT' | 'INOUT'

export interface OracleRoutineParam {
  ordinal: number
  name: string
  mode: OracleRoutineParamMode | string
  dataType: string
  dtdIdentifier?: string
  isReturn?: boolean
  /** 用户输入的字面值（不含引号时由序列化自动加） */
  value?: string
  isNull?: boolean
}

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

function qualifiedName(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

function typeLabel(p: OracleRoutineParam): string {
  return (p.dtdIdentifier || p.dataType || 'unknown').trim() || 'unknown'
}

/** 去掉精度/长度，得到基底类型名（如 VARCHAR2(50) → VARCHAR2）。 */
function baseTypeName(type: string): string {
  const t = type.trim()
  const m = /^([A-Za-z_][\w$#]*)/.exec(t)
  return m ? m[1]! : t
}

function isNumericLike(type: string): boolean {
  return /^(tinyint|smallint|int|integer|bigint|decimal|numeric|float|double|real|number|pls_integer|binary_integer|binary_float|binary_double|natural|positive|signtype)$/i.test(
    baseTypeName(type),
  )
}

function isBooleanLike(type: string): boolean {
  return /^(bool|boolean|bit)$/i.test(baseTypeName(type))
}

function isDateLike(type: string): boolean {
  return /^date$/i.test(baseTypeName(type))
}

function isTimestampLike(type: string): boolean {
  const t = type.trim()
  if (/^timestamp\b/i.test(t)) return true
  return /^(datetime|timestamp)$/i.test(baseTypeName(type))
}

function isRawLike(type: string): boolean {
  return /^(raw|long\s*raw|blob)$/i.test(baseTypeName(type)) || /^long\s+raw$/i.test(type.trim())
}

function isClobLike(type: string): boolean {
  return /^(clob|nclob|long)$/i.test(baseTypeName(type))
}

function isTimeLike(type: string): boolean {
  return /^time$/i.test(baseTypeName(type))
}

/** 已是合法 SQL 片段（关键字 / 引号字面量 / 类型构造 / 括号表达式）则原样透传。 */
function isBareSqlExpr(raw: string): boolean {
  const v = raw.trim()
  if (!v) return false
  if (/^null$/i.test(v)) return true
  if (v.startsWith("'") && v.endsWith("'")) return true
  if (v.startsWith('"') && v.endsWith('"')) return true
  if (v.startsWith('(') && v.endsWith(')')) return true
  if (/^(date|timestamp|time)\s+'/i.test(v)) return true
  if (/^q'[^\s]'/i.test(v)) return true // Oracle/DM q'…' 引号
  return false
}

/**
 * 将参数网格中的用户输入转为可写入调用 SQL 的字面量。
 * 对齐达梦/VastBase：裸字符串自动加单引号，避免 VARCHAR2 实参被当成标识符。
 */
export function formatOracleCallParamLiteral(value: string, type: string): string {
  const v = value.trim()
  if (!v || /^null$/i.test(v)) return 'NULL'
  if (isBareSqlExpr(v)) return v

  const t = type.trim()
  if (isNumericLike(t)) {
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return v
  }
  if (isBooleanLike(t)) {
    if (/^(true|t|yes|1)$/i.test(v)) return '1'
    if (/^(false|f|no|0)$/i.test(v)) return '0'
  }
  if (isDateLike(t) && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return `DATE '${v}'`
  }
  if (
    isTimestampLike(t) &&
    /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(v)
  ) {
    const norm = v.includes('T') ? v.replace('T', ' ') : v
    return `TIMESTAMP '${norm}'`
  }
  if (isTimeLike(t) && /^\d{1,2}:\d{2}(:\d{2})?$/.test(v)) {
    return `'${v}'`
  }
  if (isRawLike(t)) {
    const hex = v.replace(/^0x/i, '').replace(/[\s:-]/g, '')
    if (/^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0) {
      return `HEXTORAW('${hex}')`
    }
  }
  if (isClobLike(t)) {
    return `TO_CLOB('${v.replace(/'/g, "''")}')`
  }
  return `'${v.replace(/'/g, "''")}'`
}

export function oracleCallLiteral(p: OracleRoutineParam): string {
  const t = typeLabel(p)
  if (isBooleanLike(t)) return '0'
  if (isNumericLike(t)) return '0'
  if (isDateLike(t)) return `DATE '2020-01-01'`
  if (isTimestampLike(t)) return `TIMESTAMP '2020-01-01 00:00:00'`
  if (isTimeLike(t)) return `'00:00:00'`
  return `''`
}

export function oracleCallPlaceholder(p: OracleRoutineParam): string {
  const label = typeLabel(p)
  const comment = p.name ? ` /* ${p.name} ${label} */` : ` /* ${label} */`
  if (p.isNull) return `NULL${comment}`
  const raw = (p.value ?? '').trim()
  if (raw) return `${formatOracleCallParamLiteral(raw, label)}${comment}`
  return `${oracleCallLiteral(p)}${comment}`
}

function normalizeMode(mode: string): OracleRoutineParamMode {
  const m = mode.trim().toUpperCase().replace(/\s+/g, '')
  if (m === 'OUT') return 'OUT'
  if (m === 'INOUT' || m === 'IN/OUT') return 'INOUT'
  return 'IN'
}

function localVarName(paramName: string, ordinal: number): string {
  const raw = (paramName || '').trim()
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '')
  if (cleaned) {
    const base = /^[A-Za-z_]/.test(cleaned) ? cleaned : `p_${cleaned}`
    return `v_${base}`
  }
  return `v_p${ordinal}`
}

function plsqlType(p: OracleRoutineParam): string {
  const label = typeLabel(p)
  if (!label || label === 'unknown') return 'VARCHAR(4000)'
  // ALL_ARGUMENTS 常把无长度 VARCHAR2 报成 VARCHAR2(32767)；裸 VARCHAR2 不能作局部变量类型
  const sized = /^(VARCHAR2?|NVARCHAR2|CHAR|NCHAR)\((\d+)\)$/i.exec(label)
  if (sized) {
    const n = Math.min(Math.max(Number(sized[2]), 1), 32767)
    return `${sized[1]!.toUpperCase()}(${n})`
  }
  if (/^(VARCHAR2?|NVARCHAR2|CHAR|NCHAR)$/i.test(label)) {
    return `${label.toUpperCase()}(4000)`
  }
  return label
}

function outEchoLine(display: string, varName: string): string {
  const label = display.replace(/'/g, "''")
  return `  DBMS_OUTPUT.PUT_LINE('${label}=' || NVL(TO_CHAR(${varName}), 'NULL'));`
}

/** 去掉行注释与块注释，便于从源码解析形参列表。 */
function stripSqlComments(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]!
    const n = sql[i + 1]
    if (c === '-' && n === '-') {
      i += 2
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i + 1 < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i = Math.min(i + 2, sql.length)
      continue
    }
    out += c
    i++
  }
  return out
}

function unquoteIdent(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t.slice(1, -1).replace(/""/g, '"')
  }
  return t
}

function splitTopLevelCommas(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]!
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) {
      parts.push(list.slice(start, i))
      start = i + 1
    }
  }
  parts.push(list.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

/**
 * 从 CREATE PROCEDURE/FUNCTION 源码解析形参（ALL_ARGUMENTS 空时的前端回退）。
 * 对齐 MySQL「调用」所见即所得：至少要带上 IN/OUT 占位。
 */
export function parseOracleRoutineParamsFromDdl(
  ddl: string,
  kind: 'procedure' | 'function' = 'procedure',
): OracleRoutineParam[] {
  const src = stripSqlComments(ddl || '')
  const kw = kind === 'function' ? 'FUNCTION' : 'PROCEDURE'
  const head = new RegExp(`\\b${kw}\\b`, 'i').exec(src)
  if (!head) return []
  const afterKw = src.slice(head.index + head[0].length)
  const open = afterKw.indexOf('(')
  if (open < 0) return []
  let depth = 0
  let close = -1
  for (let i = open; i < afterKw.length; i++) {
    const ch = afterKw[i]!
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close < 0) return []

  const ident = /^("([^"]|"")+"|[A-Za-z_][\w$#]*)/
  const params: OracleRoutineParam[] = []
  for (const raw of splitTopLevelCommas(afterKw.slice(open + 1, close))) {
    const im = ident.exec(raw)
    if (!im) continue
    let rest = raw.slice(im[0].length).trim()
    let mode: OracleRoutineParamMode = 'IN'
    const modeMatch = /^(IN\s+OUT|INOUT|IN|OUT)\b/i.exec(rest)
    if (modeMatch) {
      mode = normalizeMode(modeMatch[1] || 'IN')
      rest = rest.slice(modeMatch[0].length).trim()
    }
    // DEFAULT 属于形参默认值，不是类型的一部分（INVALID 时 ALL_ARGUMENTS 空、走 DDL 回退）
    const defaultAt = /\bDEFAULT\b/i.exec(rest)
    if (defaultAt) {
      rest = rest.slice(0, defaultAt.index).trim()
    }
    const typ = rest.replace(/\s+/g, ' ').trim()
    if (!typ) continue
    params.push({
      ordinal: params.length + 1,
      name: unquoteIdent(im[0]),
      mode,
      dataType: baseTypeName(typ),
      dtdIdentifier: typ,
      isReturn: false,
    })
  }
  return params
}

/**
 * 根据形参生成可执行调用脚本（无 CREATE/DROP，避免审计触发器 / 无建表权限失败）。
 * OUT/INOUT：局部变量 + DBMS_OUTPUT（对齐 Navicat 查询编辑器常见写法）。
 * 主路径「调用 / 运行调用」请用 routine.call bind OUT，不依赖本脚本。
 */
export function buildOracleRoutineCallSql(options: {
  schema: string
  name: string
  kind: 'procedure' | 'function'
  parameters: OracleRoutineParam[]
  returnType?: string
}): string {
  const qn = qualifiedName(options.schema, options.name)
  const params = options.parameters
    .filter((p) => !p.isReturn && p.ordinal > 0)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)

  if (options.kind === 'function') {
    const args = params.map((p) => oracleCallPlaceholder(p)).join(', ')
    const head = options.returnType
      ? `-- Call function ${qn} → ${options.returnType}`
      : `-- Call function ${qn}`
    if (!args) return `${head}\nSELECT ${qn}() AS ${quoteIdent('result')} FROM DUAL;\n`
    return `${head}\nSELECT ${qn}(${args}) AS ${quoteIdent('result')} FROM DUAL;\n`
  }

  const decl: string[] = []
  const callArgs: string[] = []
  const outEcho: string[] = []

  for (const p of params) {
    const mode = normalizeMode(p.mode)
    const label = typeLabel(p)
    const display = p.name || `p${p.ordinal}`

    if (mode === 'IN') {
      callArgs.push(oracleCallPlaceholder(p))
      continue
    }

    const v = localVarName(p.name, p.ordinal)
    const typ = plsqlType(p)
    if (mode === 'INOUT') {
      const raw = (p.value ?? '').trim()
      const init = p.isNull
        ? 'NULL'
        : raw
          ? formatOracleCallParamLiteral(raw, label)
          : oracleCallLiteral(p)
      decl.push(`  ${v} ${typ} := ${init}; -- INOUT ${display} ${label}`)
    } else {
      decl.push(`  ${v} ${typ}; -- OUT ${display} ${label}`)
    }
    callArgs.push(v)
    outEcho.push(outEchoLine(display, v))
  }

  // Oracle 禁止空 DECLARE；无局部变量时省略。无 GTT/DDL，避免审计触发器与建表权限问题。
  // 始终 ENABLE：过程体内 PUT_LINE 也能被查询面板 Drain（对齐 Navicat Server Output）。
  const lines: string[] = [
    `-- Call procedure ${qn}`,
    '-- Query-pane path: DBMS_OUTPUT. Tree «Call» / Debug «Run call» use bind OUT.',
  ]
  if (decl.length > 0) {
    lines.push('DECLARE', ...decl)
  }
  lines.push('BEGIN', '  DBMS_OUTPUT.ENABLE(NULL);')
  lines.push(`  ${qn}(${callArgs.join(', ')});`)
  if (outEcho.length > 0) {
    lines.push(...outEcho)
  }
  lines.push('END;', '/')
  return `${lines.join('\n')}\n`
}
