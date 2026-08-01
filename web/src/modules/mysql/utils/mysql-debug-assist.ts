/**
 * MySQL 调试辅助：日志点 / `_debug` 草稿（只生成文本，不执行 DDL）。
 * 对齐 Navicat 级「调用 + 观测」，不是断点调试器。
 */

export const NM_DEBUG_SESSION_VAR = '@nm_debug'
export const NM_DEBUG_TRACE_VAR = '@nm_debug_trace'
export const NM_DEBUG_PARAM = 'p_nm_debug'
export const NM_DEBUG_POINT_MARKER = '/* nm-debug-point */'

function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

function escapeSqlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "''")
}

/** 已有调试日志点数量。 */
export function countMysqlDebugLogPoints(sql: string): number {
  return (sql.match(/\/\*\s*nm-debug-point(?:\s*:[^*]*)?\s*\*\//gi) ?? []).length
}

function buildLogBlock(
  kind: 'procedure' | 'function',
  label: string,
  gateExpr: string,
): string {
  const safe = escapeSqlString(label)
  // 标签必须在注释内，否则会变成非法标识符（如 `/* … */ point_1`）
  const marker = `  /* nm-debug-point: ${safe} */`
  if (kind === 'function') {
    return [
      marker,
      `  IF IFNULL(${gateExpr}, 0) <> 0 THEN`,
      `    SET ${NM_DEBUG_TRACE_VAR} = CONCAT(IFNULL(${NM_DEBUG_TRACE_VAR}, ''), '${safe};');`,
      `  END IF;`,
    ].join('\n')
  }
  return [
    marker,
    `  IF IFNULL(${gateExpr}, 0) <> 0 THEN`,
    `    SELECT '${safe}' AS ${quoteIdent('nm_debug_point')}, NOW() AS ${quoteIdent('nm_debug_at')};`,
    `  END IF;`,
  ].join('\n')
}

/** 在首个 BEGIN 后插入日志点（会话变量 `@nm_debug` 门控）。 */
export function insertMysqlDebugLogPoint(
  ddl: string,
  options: { kind: 'procedure' | 'function'; label?: string },
): string {
  const src = ddl ?? ''
  const n = countMysqlDebugLogPoints(src) + 1
  const label = (options.label || `point_${n}`).trim() || `point_${n}`
  const block = buildLogBlock(options.kind, label, NM_DEBUG_SESSION_VAR)
  return insertAfterFirstBegin(src, block)
}

/** 用 `p_nm_debug`（回退 `@nm_debug`）门控的日志点。 */
export function insertMysqlDebugLogPointParamGated(
  ddl: string,
  options: { kind: 'procedure' | 'function'; label?: string },
): string {
  const src = ddl ?? ''
  const n = countMysqlDebugLogPoints(src) + 1
  const label = (options.label || `point_${n}`).trim() || `point_${n}`
  const gate = `IFNULL(${NM_DEBUG_PARAM}, ${NM_DEBUG_SESSION_VAR})`
  const block = buildLogBlock(options.kind, label, gate)
  return insertAfterFirstBegin(src, block)
}

function insertAfterFirstBegin(src: string, block: string): string {
  const re = /\bBEGIN\b/i
  const m = re.exec(src)
  if (!m) {
    return `${src.trimEnd()}\n-- nm-debug: BEGIN not found; append manually:\n${block}\n`
  }
  const insertAt = m.index + m[0].length
  const after = src.slice(insertAt)
  return src.slice(0, insertAt) + '\n' + block + (after.startsWith('\n') ? after : `\n${after}`)
}

/**
 * 在指定行后插入日志点（1-based）。
 * 行无效或为空文本时回退到首个 BEGIN 后。
 */
export function insertMysqlDebugLogPointAtLine(
  ddl: string,
  options: { kind: 'procedure' | 'function'; line: number; label?: string },
): string {
  const src = ddl ?? ''
  if (!src.trim() || options.line < 1) {
    return insertMysqlDebugLogPoint(src, options)
  }
  const n = countMysqlDebugLogPoints(src) + 1
  const label = (options.label || `point_${n}`).trim() || `point_${n}`
  const block = buildLogBlock(options.kind, label, NM_DEBUG_SESSION_VAR)
  const lines = src.split('\n')
  const idx = Math.min(Math.max(options.line, 1), lines.length) - 1
  const next = [...lines.slice(0, idx + 1), block, ...lines.slice(idx + 1)]
  return next.join('\n')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 重命名 CREATE PROCEDURE/FUNCTION 目标名（保留库前缀）。 */
export function renameMysqlRoutineInDdl(
  ddl: string,
  kind: 'procedure' | 'function',
  from: string,
  to: string,
): string {
  const kindPat = kind === 'function' ? 'function' : 'procedure'
  const fromEsc = escapeRegExp(from)
  // 反引号名后不能用 \b（` 与 ( 都是非单词字符）
  const re = new RegExp(
    `(create\\s+(?:or\\s+replace\\s+)?${kindPat}\\s+)((?:\`[^\`]+\`|[A-Za-z0-9_$\\u0080-\\uffff]+)\\s*\\.\\s*)?(\`${fromEsc}\`|${fromEsc})(?=\\s*\\()`,
    'i',
  )
  const toIdent = quoteIdent(to)
  return ddl.replace(re, (_all, head: string, qual?: string) => `${head}${qual || ''}${toIdent}`)
}

/** 在形参列表末尾追加 IN 参数（已存在同名则跳过）。 */
export function addMysqlRoutineInParam(ddl: string, kind: 'procedure' | 'function', paramDecl: string): string {
  if (new RegExp(`\\b${escapeRegExp(NM_DEBUG_PARAM)}\\b`, 'i').test(ddl) && /p_nm_debug/i.test(paramDecl)) {
    return ddl
  }
  const kindPat = kind === 'function' ? 'function' : 'procedure'
  const re = new RegExp(
    `(create\\s+(?:or\\s+replace\\s+)?${kindPat}\\s+(?:(?:\`[^\`]+\`|[A-Za-z0-9_$\\u0080-\\uffff]+)\\s*\\.\\s*)?(?:\`[^\`]+\`|[A-Za-z0-9_$\\u0080-\\uffff]+)\\s*)\\(`,
    'i',
  )
  const m = re.exec(ddl)
  if (!m) return ddl
  const openIdx = m.index + m[0].length - 1
  let depth = 0
  let closeIdx = -1
  for (let i = openIdx; i < ddl.length; i++) {
    const c = ddl[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        closeIdx = i
        break
      }
    }
  }
  if (closeIdx < 0) return ddl
  const inside = ddl.slice(openIdx + 1, closeIdx).trim()
  const insertion = inside ? `${inside}, IN ${paramDecl}` : `IN ${paramDecl}`
  return ddl.slice(0, openIdx + 1) + insertion + ddl.slice(closeIdx)
}

/**
 * 生成 `*_debug` 草稿：改名、追加 `p_nm_debug`、插入 enter 日志点。
 * 不触碰线上对象。
 */
export function buildMysqlDebugRoutineDraft(options: {
  ddl: string
  kind: 'procedure' | 'function'
  originalName: string
  draftSuffix?: string
}): { ddl: string; draftName: string } {
  const suffix = options.draftSuffix ?? '_debug'
  const draftName = options.originalName.endsWith(suffix)
    ? options.originalName
    : `${options.originalName}${suffix}`

  let s = (options.ddl ?? '').trim()
  s = renameMysqlRoutineInDdl(s, options.kind, options.originalName, draftName)
  s = addMysqlRoutineInParam(s, options.kind, `${NM_DEBUG_PARAM} TINYINT`)
  if (countMysqlDebugLogPoints(s) === 0) {
    s = insertMysqlDebugLogPointParamGated(s, { kind: options.kind, label: 'enter' })
  }

  const header = [
    `-- nm-debug draft: ${draftName}`,
    `-- Will not change the live object until you create/save intentionally.`,
    `-- Enable with ${NM_DEBUG_PARAM}=1 or SET ${NM_DEBUG_SESSION_VAR}=1 before CALL/SELECT.`,
    '',
  ].join('\n')

  return { ddl: `${header}${s}\n`, draftName }
}

/** 调用脚本前开启会话调试开关（可选读回函数 trace）。 */
export function wrapMysqlCallWithDebugSession(
  callSql: string,
  options?: { kind?: 'procedure' | 'function' },
): string {
  const lines = [
    `SET ${NM_DEBUG_SESSION_VAR} = 1;`,
    `SET ${NM_DEBUG_TRACE_VAR} = '';`,
    callSql.trimEnd(),
  ]
  if (options?.kind === 'function') {
    lines.push(`SELECT ${NM_DEBUG_TRACE_VAR} AS ${quoteIdent('nm_debug_trace')};`)
  }
  return `${lines.join('\n')}\n`
}
