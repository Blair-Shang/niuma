/**
 * 达梦例程调用 SQL 生成（Oracle/DM 风格）。
 * - 函数：SELECT schema.fn(in…) AS result FROM DUAL
 * - 无 OUT 过程：DECLARE … BEGIN schema.proc(…); END; /
 * - 有 OUT/INOUT：每次调用唯一 GTT + SELECT 回显，读完即 DROP，避免多页签/多用户抢表
 * 参数网格所见即所得：未加引号的字符串值由序列化自动加单引号。
 */

export type DamengRoutineParamMode = 'IN' | 'OUT' | 'INOUT'

export interface DamengRoutineParam {
  ordinal: number
  name: string
  mode: DamengRoutineParamMode | string
  dataType: string
  dtdIdentifier?: string
  isReturn?: boolean
  /** 用户输入的字面值（不含引号时由序列化自动加） */
  value?: string
  isNull?: boolean
}

/**
 * 为 OUT 回显分配全局临时表名（每次调用唯一）。
 * 形如 NM_CO_<time36>_<rand>，短标识便于达梦 DDL，并降低并发冲突。
 */
export function allocDamengCallOutTableName(
  now: number = Date.now(),
  rand: number = Math.random(),
): string {
  const timePart = Math.abs(now).toString(36).toUpperCase()
  const randPart = Math.floor(Math.abs(rand) * 0xffffff)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0')
  const raw = `NM_CO_${timePart}_${randPart}`
  return raw.replace(/[^A-Z0-9_]/g, '_').slice(0, 28)
}

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

function qualifiedName(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

function typeLabel(p: DamengRoutineParam): string {
  return (p.dtdIdentifier || p.dataType || 'unknown').trim() || 'unknown'
}

/** 去掉精度/长度，得到基底类型名（如 VARCHAR2(50) → VARCHAR2）。 */
function baseTypeName(type: string): string {
  const t = type.trim()
  const m = /^([A-Za-z_][\w$#]*)/.exec(t)
  return m ? m[1]! : t
}

function isNumericLike(type: string): boolean {
  return /^(tinyint|smallint|int|integer|bigint|decimal|numeric|float|double|real|number|pls_integer|binary_integer)$/i.test(
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
  return /^(datetime|timestamp)$/i.test(baseTypeName(type))
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
 * 对齐 VastBase：裸字符串自动加单引号，避免 VARCHAR2 实参被当成标识符。
 */
export function formatDamengCallParamLiteral(value: string, type: string): string {
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
  return `'${v.replace(/'/g, "''")}'`
}

export function damengCallLiteral(p: DamengRoutineParam): string {
  const t = typeLabel(p)
  if (isBooleanLike(t)) return '0'
  if (isNumericLike(t)) return '0'
  if (isDateLike(t)) return `DATE '2020-01-01'`
  if (isTimestampLike(t)) return `TIMESTAMP '2020-01-01 00:00:00'`
  if (isTimeLike(t)) return `'00:00:00'`
  return `''`
}

export function damengCallPlaceholder(p: DamengRoutineParam): string {
  const label = typeLabel(p)
  const comment = p.name ? ` /* ${p.name} ${label} */` : ` /* ${label} */`
  if (p.isNull) return `NULL${comment}`
  const raw = (p.value ?? '').trim()
  if (raw) return `${formatDamengCallParamLiteral(raw, label)}${comment}`
  return `${damengCallLiteral(p)}${comment}`
}

function normalizeMode(mode: string): DamengRoutineParamMode {
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

function plsqlType(p: DamengRoutineParam): string {
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

function dropTableBlock(tblQuoted: string): string[] {
  return [
    'BEGIN',
    `  EXECUTE IMMEDIATE 'DROP TABLE ${tblQuoted}';`,
    'EXCEPTION',
    '  WHEN OTHERS THEN NULL;',
    'END;',
    '/',
  ]
}

/**
 * 根据 ALL_ARGUMENTS 形参生成可执行调用脚本。
 * 有 OUT/INOUT 时经「本次唯一」全局临时表读回一行；读完即 DROP，避免并发抢表。
 */
export function buildDamengRoutineCallSql(options: {
  schema: string
  name: string
  kind: 'procedure' | 'function'
  parameters: DamengRoutineParam[]
  returnType?: string
  /** 测试注入；默认每次调用分配唯一表名 */
  outTableName?: string
}): string {
  const qn = qualifiedName(options.schema, options.name)
  const params = options.parameters
    .filter((p) => !p.isReturn && p.ordinal > 0)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)

  if (options.kind === 'function') {
    const args = params.map((p) => damengCallPlaceholder(p)).join(', ')
    const head = options.returnType
      ? `-- Call function ${qn} → ${options.returnType}`
      : `-- Call function ${qn}`
    if (!args) return `${head}\nSELECT ${qn}() AS ${quoteIdent('result')} FROM DUAL;\n`
    return `${head}\nSELECT ${qn}(${args}) AS ${quoteIdent('result')} FROM DUAL;\n`
  }

  const decl: string[] = []
  const callArgs: string[] = []
  const outCols: { ident: string; varName: string; typ: string }[] = []

  for (const p of params) {
    const mode = normalizeMode(p.mode)
    const label = typeLabel(p)
    const display = p.name || `p${p.ordinal}`

    if (mode === 'IN') {
      callArgs.push(damengCallPlaceholder(p))
      continue
    }

    const v = localVarName(p.name, p.ordinal)
    const typ = plsqlType(p)
    if (mode === 'INOUT') {
      const raw = (p.value ?? '').trim()
      const init = p.isNull
        ? 'NULL'
        : raw
          ? formatDamengCallParamLiteral(raw, label)
          : damengCallLiteral(p)
      decl.push(`  ${v} ${typ} := ${init}; -- INOUT ${display} ${label}`)
    } else {
      decl.push(`  ${v} ${typ}; -- OUT ${display} ${label}`)
    }
    callArgs.push(v)
    outCols.push({ ident: quoteIdent(display), varName: v, typ })
  }

  // 无 OUT：纯匿名块即可（过程内 SELECT/游标仍可能产生结果集，由执行器自行带回）
  if (outCols.length === 0) {
    const lines: string[] = [`-- Call procedure ${qn}`, 'DECLARE', '  -- no OUT/INOUT locals', 'BEGIN']
    lines.push(`  ${qn}(${callArgs.join(', ')});`)
    lines.push('END;')
    lines.push('/')
    return `${lines.join('\n')}\n`
  }

  const tableName = (options.outTableName?.trim() || allocDamengCallOutTableName()).replace(
    /[^A-Za-z0-9_]/g,
    '_',
  )
  const safeName = (/^[A-Za-z]/.test(tableName) ? tableName : `NM_CO_${tableName}`).slice(0, 28)
  const tbl = quoteIdent(safeName)
  const colDefs = outCols.map((c) => `  ${c.ident} ${c.typ}`).join(',\n')
  const insertCols = outCols.map((c) => c.ident).join(', ')
  const insertVals = outCols.map((c) => c.varName).join(', ')

  // 唯一表名：只 DROP 自己的表，不伤其它页签；开头 DROP 便于同脚本重跑，结尾 DROP 减目录残留
  // ON COMMIT PRESERVE ROWS：逐句 auto-commit 后 SELECT 仍能读到 INSERT 的行
  const lines: string[] = [
    `-- Call procedure ${qn} (OUT via unique GTT ${safeName})`,
    ...dropTableBlock(tbl),
    `CREATE GLOBAL TEMPORARY TABLE ${tbl} (`,
    colDefs,
    ') ON COMMIT PRESERVE ROWS;',
    'DECLARE',
    ...decl,
    'BEGIN',
    `  ${qn}(${callArgs.join(', ')});`,
    `  INSERT INTO ${tbl} (${insertCols}) VALUES (${insertVals});`,
    'END;',
    '/',
    `SELECT * FROM ${tbl};`,
    ...dropTableBlock(tbl),
  ]
  return `${lines.join('\n')}\n`
}
