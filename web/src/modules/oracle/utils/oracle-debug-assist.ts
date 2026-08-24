/**
 * Oracle 调试辅助：日志点 / `_debug` 草稿（只生成文本，不执行 DDL）。
 * 对齐 Navicat 级「调用 + 观测」，不是断点调试器。
 *
 * 会话门控：CLIENT_INFO = 'nm_debug=1'（DBMS_APPLICATION_INFO）。
 * 草稿门控：形参 p_nm_debug。
 */

export const NM_DEBUG_CLIENT_INFO = 'nm_debug=1'
export const NM_DEBUG_PARAM = 'p_nm_debug'
export const NM_DEBUG_POINT_MARKER = '/* nm-debug-point */'

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''")
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 已有调试日志点数量。 */
export function countOracleDebugLogPoints(sql: string): number {
  return (sql.match(/\/\*\s*nm-debug-point(?:\s*:[^*]*)?\s*\*\//gi) ?? []).length
}

const CLIENT_INFO_GATE = `SYS_CONTEXT('USERENV', 'CLIENT_INFO')`

function buildLogBlock(label: string, gateExpr: string): string {
  const safe = escapeSqlString(label)
  // 标签必须在注释内，否则会变成非法标识符
  const marker = `  /* nm-debug-point: ${safe} */`
  return [
    marker,
    `  IF ${gateExpr} THEN`,
    `    DBMS_OUTPUT.PUT_LINE('nm_debug_point:' || '${safe}');`,
    `  END IF;`,
  ].join('\n')
}

function sessionGateExpr(): string {
  return `NVL(${CLIENT_INFO_GATE}, ' ') = '${NM_DEBUG_CLIENT_INFO}'`
}

function paramGateExpr(): string {
  return `NVL(${NM_DEBUG_PARAM}, 0) <> 0 OR ${sessionGateExpr()}`
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

/** 在首个 BEGIN 后插入日志点（CLIENT_INFO 门控）。 */
export function insertOracleDebugLogPoint(
  ddl: string,
  options?: { label?: string },
): string {
  const src = ddl ?? ''
  const n = countOracleDebugLogPoints(src) + 1
  const label = (options?.label || `point_${n}`).trim() || `point_${n}`
  const block = buildLogBlock(label, sessionGateExpr())
  return insertAfterFirstBegin(src, block)
}

/** 用 `p_nm_debug`（回退 CLIENT_INFO）门控的日志点。 */
export function insertOracleDebugLogPointParamGated(
  ddl: string,
  options?: { label?: string },
): string {
  const src = ddl ?? ''
  const n = countOracleDebugLogPoints(src) + 1
  const label = (options?.label || `point_${n}`).trim() || `point_${n}`
  const block = buildLogBlock(label, paramGateExpr())
  return insertAfterFirstBegin(src, block)
}

/**
 * 在指定行后插入日志点（1-based）。
 * 行无效或为空文本时回退到首个 BEGIN 后。
 */
export function insertOracleDebugLogPointAtLine(
  ddl: string,
  options: { line: number; label?: string },
): string {
  const src = ddl ?? ''
  if (!src.trim() || options.line < 1) {
    return insertOracleDebugLogPoint(src, options)
  }
  const n = countOracleDebugLogPoints(src) + 1
  const label = (options.label || `point_${n}`).trim() || `point_${n}`
  const block = buildLogBlock(label, sessionGateExpr())
  const lines = src.split('\n')
  const idx = Math.min(Math.max(options.line, 1), lines.length) - 1
  const next = [...lines.slice(0, idx + 1), block, ...lines.slice(idx + 1)]
  return next.join('\n')
}

/** 重命名 CREATE PROCEDURE/FUNCTION 目标名（保留 schema 前缀）。 */
export function renameOracleRoutineInDdl(
  ddl: string,
  kind: 'procedure' | 'function',
  from: string,
  to: string,
): string {
  const kindPat = kind === 'function' ? 'function' : 'procedure'
  const fromEsc = escapeRegExp(from)
  const re = new RegExp(
    `(create\\s+(?:or\\s+replace\\s+)?${kindPat}\\s+)((?:"[^"]+"|[A-Za-z0-9_$\\u0080-\\uffff]+)\\s*\\.\\s*)?("${fromEsc}"|${fromEsc})(?=\\s*\\()`,
    'i',
  )
  const toIdent = quoteIdent(to)
  return ddl.replace(re, (_all, head: string, qual?: string) => `${head}${qual || ''}${toIdent}`)
}

/** 在形参列表末尾追加 IN 参数（已存在同名则跳过）。 */
export function addOracleRoutineInParam(
  ddl: string,
  kind: 'procedure' | 'function',
  paramDecl: string,
): string {
  if (new RegExp(`\\b${escapeRegExp(NM_DEBUG_PARAM)}\\b`, 'i').test(ddl) && /p_nm_debug/i.test(paramDecl)) {
    return ddl
  }
  const kindPat = kind === 'function' ? 'function' : 'procedure'
  const re = new RegExp(
    `(create\\s+(?:or\\s+replace\\s+)?${kindPat}\\s+(?:(?:"[^"]+"|[A-Za-z0-9_$\\u0080-\\uffff]+)\\s*\\.\\s*)?(?:"[^"]+"|[A-Za-z0-9_$\\u0080-\\uffff]+)\\s*)\\(`,
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
  const insertion = inside ? `${inside}, ${paramDecl}` : paramDecl
  return ddl.slice(0, openIdx + 1) + insertion + ddl.slice(closeIdx)
}

/**
 * 生成 `*_debug` 草稿：改名、追加 `p_nm_debug`、插入 enter 日志点。
 * 不触碰线上对象。
 */
export function buildOracleDebugRoutineDraft(options: {
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
  s = renameOracleRoutineInDdl(s, options.kind, options.originalName, draftName)
  s = addOracleRoutineInParam(s, options.kind, `${NM_DEBUG_PARAM} INT DEFAULT 0`)
  if (countOracleDebugLogPoints(s) === 0) {
    s = insertOracleDebugLogPointParamGated(s, { label: 'enter' })
  }

  const header = [
    `-- nm-debug draft: ${draftName}`,
    `-- Will not change the live object until you create/save intentionally.`,
    `-- Enable with ${NM_DEBUG_PARAM}=1 or CLIENT_INFO='${NM_DEBUG_CLIENT_INFO}'.`,
    '',
  ].join('\n')

  return { ddl: `${header}${s}\n`, draftName }
}

/** 调用脚本前开启 DBMS_OUTPUT 与 CLIENT_INFO 调试开关。 */
export function wrapOracleCallWithDebugSession(callSql: string): string {
  const lines = [
    'BEGIN',
    '  DBMS_OUTPUT.ENABLE(NULL);',
    `  DBMS_APPLICATION_INFO.SET_CLIENT_INFO('${NM_DEBUG_CLIENT_INFO}');`,
    'END;',
    '/',
    callSql.trimEnd(),
    'BEGIN',
    '  DBMS_APPLICATION_INFO.SET_CLIENT_INFO(NULL);',
    'END;',
    '/',
  ]
  return `${lines.join('\n')}\n`
}
