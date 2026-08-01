/**
 * Kingbase 例程调用 SQL：解析 identity args、所见即所得填参、生成 CALL/SELECT。
 * 对齐 Vastbase / Navicat；兼容 PG 标准 `INOUT name type` 与金仓 `name INOUT type`。
 */
import { ensureBatchExecMarker } from '@/modules/kingbase/utils/query-exec-mode'

const TYPE_START =
  /^(integer|int|int2|int4|int8|bigint|smallint|text|varchar|character|char|boolean|bool|numeric|decimal|real|double|float|money|bytea|json|jsonb|uuid|date|time|timestamp|timestamptz|interval|oid|name|anyelement|anyarray|record|void|cstring|regclass|regprocedure|regtype|regnamespace|regrole|bit|varbit|box|circle|line|lseg|path|point|polygon|inet|cidr|macaddr|macaddr8|xml|tsvector|tsquery|pg_lsn)$/i

export type RoutineArgMode = 'in' | 'out' | 'inout' | 'variadic'

/** 所见即所得参数行（调试辅助 / 调用向导）。 */
export interface RoutineCallParam {
  index: number
  name: string
  type: string
  mode: RoutineArgMode
  /** 用户输入的字面值（不含引号时由序列化自动加） */
  value: string
  isNull: boolean
}

/** 按括号/方括号深度拆分 identity args（兼容 numeric(10,2) 等）。 */
export function splitIdentityArgs(args: string): string[] {
  const raw = args.trim()
  if (!raw) return []
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of raw) {
    if (ch === '(' || ch === '[') depth += 1
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      const t = cur.trim()
      if (t) parts.push(t)
      cur = ''
      continue
    }
    cur += ch
  }
  const last = cur.trim()
  if (last) parts.push(last)
  return parts
}

function parseModePrefix(part: string): { mode: RoutineArgMode; rest: string } {
  const m = /^(IN|OUT|INOUT|VARIADIC)\s+/i.exec(part.trim())
  if (!m) return { mode: 'in', rest: part.trim() }
  const mode = m[1]!.toLowerCase() as RoutineArgMode
  return { mode, rest: part.trim().slice(m[0].length).trim() }
}

/** 金仓 / Oracle 风格：`name INOUT type`（mode 夹在名称与类型之间）。 */
function parseModeInfix(rest: string): {
  name?: string
  type: string
  mode: RoutineArgMode
} | null {
  const quoted = /^"((?:[^"]|"")+)"\s+(IN|OUT|INOUT|VARIADIC)\s+(.+)$/i.exec(rest)
  if (quoted) {
    return {
      name: quoted[1]!.replace(/""/g, '"'),
      mode: quoted[2]!.toLowerCase() as RoutineArgMode,
      type: quoted[3]!.trim(),
    }
  }
  const bare = /^([A-Za-z_][\w$]*)\s+(IN|OUT|INOUT|VARIADIC)\s+(.+)$/i.exec(rest)
  if (!bare) return null
  const maybeName = bare[1]!
  if (TYPE_START.test(maybeName)) return null
  return {
    name: maybeName,
    mode: bare[2]!.toLowerCase() as RoutineArgMode,
    type: bare[3]!.trim(),
  }
}

/** 从 identity 参数片段解析名称、类型与模式。 */
export function parseIdentityArg(part: string): {
  name?: string
  type: string
  mode: RoutineArgMode
} {
  const { mode: prefixMode, rest } = parseModePrefix(part)
  if (!rest) return { type: 'unknown', mode: prefixMode }

  // 仅当前缀未声明 mode 时尝试 `name INOUT type`
  if (prefixMode === 'in') {
    const infix = parseModeInfix(rest)
    if (infix) return infix
  }

  const quoted = /^"((?:[^"]|"")+)"\s+(.+)$/.exec(rest)
  if (quoted) {
    return {
      name: quoted[1]!.replace(/""/g, '"'),
      type: quoted[2]!.trim(),
      mode: prefixMode,
    }
  }

  const named = /^([A-Za-z_][\w$]*)\s+(.+)$/.exec(rest)
  if (named) {
    const maybeName = named[1]!
    const typeRest = named[2]!.trim()
    if (TYPE_START.test(maybeName)) {
      return { type: rest, mode: prefixMode }
    }
    return { name: maybeName, type: typeRest, mode: prefixMode }
  }

  return { type: rest, mode: prefixMode }
}

/** 由 identity args 构建参数网格行。 */
export function buildCallParams(identityArgs: string | undefined | null): RoutineCallParam[] {
  const parts = splitIdentityArgs(identityArgs ?? '')
  return parts.map((part, i) => {
    const { name, type, mode } = parseIdentityArg(part)
    return {
      index: i + 1,
      name: name || `$${i + 1}`,
      type,
      mode,
      value: '',
      isNull: false,
    }
  })
}

function isNumericType(type: string): boolean {
  return /^(smallint|integer|int\d*|bigint|numeric|decimal|real|double(\s+precision)?|float\d*|money|oid)$/i.test(
    type.trim(),
  )
}

function isBooleanType(type: string): boolean {
  return /^(boolean|bool)$/i.test(type.trim())
}

function normalizeBool(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === 't' || v === 'yes' || v === '1') return 'TRUE'
  if (v === 'false' || v === 'f' || v === 'no' || v === '0') return 'FALSE'
  return raw.trim()
}

/** 将单格用户输入转为 SQL 字面量。 */
export function formatCallParamLiteral(value: string, type: string): string {
  const v = value.trim()
  if (!v || /^null$/i.test(v)) return 'NULL'
  if (
    (v.startsWith("'") && v.endsWith("'")) ||
    /^\$[A-Za-z0-9_]*\$[\s\S]*\$[A-Za-z0-9_]*\$/.test(v) ||
    /::[A-Za-z_][\w\s.[\]]*$/.test(v) ||
    /^\(.*\)$/.test(v)
  ) {
    return v
  }
  if (isNumericType(type)) {
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return v
  }
  if (isBooleanType(type)) {
    if (/^(true|false|t|f|yes|no|1|0)$/i.test(v)) return normalizeBool(v)
  }
  return `'${v.replace(/'/g, "''")}'`
}

/** 将参数网格序列化为 CALL/SELECT 实参（不含外层括号）。 */
export function serializeCallParams(params: RoutineCallParam[]): string {
  if (params.length === 0) return ''
  // 未填值也必须占位：空实参列表会变成 fn()，PG/金仓按 0 参重载解析，易误报 does not exist。
  return params
    .map((p) => {
      if (p.isNull) return 'NULL'
      if (!p.value.trim()) return `NULL::${(p.type || 'text').trim() || 'text'}`
      return formatCallParamLiteral(p.value, p.type)
    })
    .join(', ')
}

/** 生成 `NULL::type` + 块注释形参名列表（查询种子 / 高级模式；避免行注释 `--` 吞掉同行 `);`）。 */
export function buildCallPlaceholders(identityArgs: string | undefined | null): string {
  const parts = splitIdentityArgs(identityArgs ?? '')
  if (parts.length === 0) return ''
  return parts
    .map((part, i) => {
      const { name, type } = parseIdentityArg(part)
      const comment = name ? ` /* ${name} */` : ` /* $${i + 1} */`
      return `NULL::${type}${comment}`
    })
    .join(',\n  ')
}

function inLiteral(p: RoutineCallParam): string {
  if (p.isNull) return 'NULL'
  const raw = (p.value ?? '').trim()
  if (raw) return formatCallParamLiteral(raw, p.type)
  return `NULL::${p.type || 'text'}`
}

function wrapArgList(argList: string): string {
  if (!argList) return ''
  return argList.includes('\n') ? `\n  ${argList}\n` : argList
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

/** DO 块局部变量类型（裸 varchar 需长度）。 */
function plType(type: string): string {
  const t = (type || '').trim()
  if (!t || t === 'unknown') return 'text'
  if (/^(varchar|character\s+varying|nvarchar)$/i.test(t)) return 'varchar(4000)'
  if (/^(char|character|nchar)$/i.test(t)) return 'char(1)'
  return t
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`
}

const NM_CALL_OUT_TABLE = 'nm_call_out'

/**
 * 根据 identity args / 参数网格生成可执行调用脚本。
 * - 函数：SELECT schema.fn(…)（查询页走分页 query.exec）
 * - 无 OUT 过程：CALL schema.proc(…)（同上）
 * - 有 OUT/INOUT：DO + 临时表 + SELECT（脚本带 `-- niuma:exec=batch`；调试「运行调用」走 routine.call）
 */
export function buildRoutineCallSql(options: {
  schema: string
  name: string
  kind?: 'function' | 'procedure'
  args?: string | null
  /** 已填好的参数行；优先于 args 占位 */
  params?: RoutineCallParam[]
  qualify: (schema: string, name: string) => string
}): string {
  const qn = options.qualify(options.schema, options.name)
  const params = options.params ?? buildCallParams(options.args)
  const kind = options.kind === 'procedure' ? 'procedure' : 'function'

  if (kind === 'function') {
    const argList = options.params
      ? serializeCallParams(params)
      : buildCallPlaceholders(options.args)
    return `-- Call function ${qn}\nSELECT ${qn}(${wrapArgList(argList)});\n`
  }

  const hasOut = params.some((p) => p.mode === 'out' || p.mode === 'inout')
  if (!hasOut) {
    const argList = options.params
      ? serializeCallParams(params)
      : buildCallPlaceholders(options.args)
    return `-- Call procedure ${qn}\nCALL ${qn}(${wrapArgList(argList)});\n`
  }

  const decl: string[] = []
  const callArgs: string[] = []
  const outCols: { ident: string; varName: string }[] = []

  for (const p of params) {
    const display = p.name || `$${p.index}`
    if (p.mode === 'out' || p.mode === 'inout') {
      const v = localVarName(p.name, p.index)
      const typ = plType(p.type)
      if (p.mode === 'inout') {
        decl.push(`  ${v} ${typ} := ${inLiteral(p)}; -- INOUT ${display}`)
      } else {
        decl.push(`  ${v} ${typ}; -- OUT ${display}`)
      }
      callArgs.push(v)
      outCols.push({ ident: quoteIdent(display), varName: v })
      continue
    }
    if (options.params) {
      callArgs.push(`${inLiteral(p)} /* ${display} */`)
    } else {
      callArgs.push(`NULL::${p.type || 'text'} /* ${display} */`)
    }
  }

  const colDefs = outCols.map((c) => `  ${c.ident} text`).join(',\n')
  const insertCols = outCols.map((c) => c.ident).join(', ')
  const insertVals = outCols.map((c) => `${c.varName}::text`).join(', ')

  const lines: string[] = [
    `-- Call procedure ${qn} (OUT via temp table; Debug «Run call» uses routine.call)`,
    `DROP TABLE IF EXISTS pg_temp.${NM_CALL_OUT_TABLE};`,
    `CREATE TEMP TABLE ${NM_CALL_OUT_TABLE} (`,
    colDefs,
    ');',
    'DO $$',
    'DECLARE',
  ]
  if (decl.length === 0) {
    lines.push('  -- no OUT locals')
  } else {
    lines.push(...decl)
  }
  lines.push('BEGIN')
  if (callArgs.length === 0) {
    lines.push(`  CALL ${qn}();`)
  } else if (callArgs.length === 1) {
    lines.push(`  CALL ${qn}(${callArgs[0]});`)
  } else {
    lines.push(`  CALL ${qn}(`)
    for (let i = 0; i < callArgs.length; i++) {
      const comma = i < callArgs.length - 1 ? ',' : ''
      lines.push(`    ${callArgs[i]}${comma}`)
    }
    lines.push('  );')
  }
  lines.push(`  INSERT INTO ${NM_CALL_OUT_TABLE} (${insertCols}) VALUES (${insertVals});`)
  lines.push('END $$;')
  lines.push(`SELECT * FROM ${NM_CALL_OUT_TABLE};`)
  lines.push('')
  // 查询页凭此标识走同连接批跑，否则临时表不可见
  return ensureBatchExecMarker(lines.join('\n'))
}

