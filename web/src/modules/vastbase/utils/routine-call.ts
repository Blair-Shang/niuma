/**
 * 例程调用参数：解析 identity args、所见即所得填参、序列化为 CALL/SELECT 实参。
 * 对齐 Navicat「执行函数/过程」参数网格。
 */

const TYPE_START =
  /^(integer|int|int2|int4|int8|bigint|smallint|text|varchar|character|char|boolean|bool|numeric|decimal|real|double|float|money|bytea|json|jsonb|uuid|date|time|timestamp|timestamptz|interval|oid|name|anyelement|anyarray|record|void|cstring|regclass|regprocedure|regtype|regnamespace|regrole|bit|varbit|box|circle|line|lseg|path|point|polygon|inet|cidr|macaddr|macaddr8|xml|tsvector|tsquery|pg_lsn)$/i

export type RoutineArgMode = 'in' | 'out' | 'inout' | 'variadic'

/** 所见即所得参数行（调试 / 调用向导）。 */
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

function parseMode(part: string): { mode: RoutineArgMode; rest: string } {
  const m = /^(IN|OUT|INOUT|VARIADIC)\s+/i.exec(part.trim())
  if (!m) return { mode: 'in', rest: part.trim() }
  const mode = m[1]!.toLowerCase() as RoutineArgMode
  return { mode, rest: part.trim().slice(m[0].length).trim() }
}

/** 从 identity 参数片段解析名称、类型与模式。 */
export function parseIdentityArg(part: string): {
  name?: string
  type: string
  mode: RoutineArgMode
} {
  const { mode, rest } = parseMode(part)
  if (!rest) return { type: 'unknown', mode }

  const quoted = /^"((?:[^"]|"")+)"\s+(.+)$/.exec(rest)
  if (quoted) {
    return {
      name: quoted[1]!.replace(/""/g, '"'),
      type: quoted[2]!.trim(),
      mode,
    }
  }

  const named = /^([A-Za-z_][\w$]*)\s+(.+)$/.exec(rest)
  if (named) {
    const maybeName = named[1]!
    const typeRest = named[2]!.trim()
    if (TYPE_START.test(maybeName)) {
      return { type: rest, mode }
    }
    return { name: maybeName, type: typeRest, mode }
  }

  return { type: rest, mode }
}

/** 由 identity args 构建参数网格行（空值 = 使用形参 DEFAULT，勿默认塞 SQL NULL）。 */
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
  // 已是引号 / dollar-quote / 类型强转表达式，原样透传
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

/** 将参数网格序列化为 debug/call 的 callArgs（不含外层括号）。 */
export function serializeCallParams(params: RoutineCallParam[]): string {
  if (params.length === 0) return ''
  // 全部未填且未勾选 NULL → 零实参 CALL，走库端 DEFAULT（如 p_debug DEFAULT TRUE）
  const allUseDefault = params.every((p) => !p.isNull && !p.value.trim())
  if (allUseDefault) return ''

  return params
    .map((p) => {
      if (p.isNull) return 'NULL'
      if (!p.value.trim()) return 'DEFAULT'
      return formatCallParamLiteral(p.value, p.type)
    })
    .join(', ')
}

/** 生成 `NULL::type -- name` 列表（查询种子 / 高级模式）。 */
export function buildCallPlaceholders(identityArgs: string | undefined | null): string {
  const parts = splitIdentityArgs(identityArgs ?? '')
  if (parts.length === 0) return ''
  return parts
    .map((part, i) => {
      const { name, type } = parseIdentityArg(part)
      const comment = name ? ` -- ${name}` : ` -- $${i + 1}`
      return `NULL::${type}${comment}`
    })
    .join(',\n  ')
}

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
  const argList = options.params
    ? serializeCallParams(options.params)
    : buildCallPlaceholders(options.args)
  const wrapped = argList.includes('\n')
    ? `\n  ${argList}\n`
    : argList
      ? argList
      : ''
  if (options.kind === 'procedure') {
    return `-- Generated CALL\nCALL ${qn}(${wrapped});`
  }
  return `-- Generated call\nSELECT ${qn}(${wrapped});`
}
