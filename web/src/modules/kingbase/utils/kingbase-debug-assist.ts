/**
 * Kingbase 调试辅助：日志点草稿（只生成文本，不执行 DDL）。
 * 对齐 Navicat 级「调用 + 观测」，不是断点调试器。
 *
 * 会话门控：set_config('niuma.debug','1',false)
 * 草稿门控：形参 p_nm_debug
 */

export const NM_DEBUG_GUC = 'niuma.debug'
export const NM_DEBUG_PARAM = 'p_nm_debug'
export const NM_DEBUG_POINT_MARKER = '/* nm-debug-point */'

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''")
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 已有调试日志点数量。 */
export function countKingbaseDebugLogPoints(sql: string): number {
  return (sql.match(/\/\*\s*nm-debug-point(?:\s*:[^*]*)?\s*\*\//gi) ?? []).length
}

function sessionGateExpr(): string {
  return `current_setting('${NM_DEBUG_GUC}', true) = '1'`
}

function paramGateExpr(): string {
  return `COALESCE(${NM_DEBUG_PARAM}, 0) <> 0 OR ${sessionGateExpr()}`
}

function buildLogBlock(label: string, gateExpr: string): string {
  const safe = escapeSqlString(label)
  const marker = `  /* nm-debug-point: ${safe} */`
  return [
    marker,
    `  IF ${gateExpr} THEN`,
    `    RAISE NOTICE 'nm_debug_point:%', '${safe}';`,
    `  END IF;`,
  ].join('\n')
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

/** 在首个 BEGIN 后插入日志点（会话 GUC 门控）。 */
export function insertKingbaseDebugLogPoint(
  ddl: string,
  options?: { label?: string },
): string {
  const src = ddl ?? ''
  const n = countKingbaseDebugLogPoints(src) + 1
  const label = (options?.label || `point_${n}`).trim() || `point_${n}`
  const block = buildLogBlock(label, sessionGateExpr())
  return insertAfterFirstBegin(src, block)
}

/** 用 `p_nm_debug`（回退会话 GUC）门控的日志点。 */
export function insertKingbaseDebugLogPointParamGated(
  ddl: string,
  options?: { label?: string },
): string {
  const src = ddl ?? ''
  const n = countKingbaseDebugLogPoints(src) + 1
  const label = (options?.label || `point_${n}`).trim() || `point_${n}`
  const block = buildLogBlock(label, paramGateExpr())
  return insertAfterFirstBegin(src, block)
}

/**
 * 在指定行后插入日志点（1-based）。
 * 行无效或为空文本时回退到首个 BEGIN 后。
 */
export function insertKingbaseDebugLogPointAtLine(
  ddl: string,
  options: { line: number; label?: string },
): string {
  const src = ddl ?? ''
  if (!src.trim() || options.line < 1) {
    return insertKingbaseDebugLogPoint(src, options)
  }
  const n = countKingbaseDebugLogPoints(src) + 1
  const label = (options.label || `point_${n}`).trim() || `point_${n}`
  const block = buildLogBlock(label, sessionGateExpr())
  const lines = src.split('\n')
  const idx = Math.min(Math.max(options.line, 1), lines.length) - 1
  const next = [...lines.slice(0, idx + 1), block, ...lines.slice(idx + 1)]
  return next.join('\n')
}

/** 调用脚本前开启 RAISE NOTICE 调试开关。 */
export function wrapKingbaseCallWithDebugSession(callSql: string): string {
  const lines = [
    `-- Enable NOTICE for RAISE NOTICE log points (session-local)`,
    `SELECT set_config('${NM_DEBUG_GUC}', '1', false);`,
    `SET client_min_messages TO NOTICE;`,
    callSql.trimEnd(),
    `SELECT set_config('${NM_DEBUG_GUC}', '', false);`,
  ]
  return `${lines.join('\n')}\n`
}

/** 去掉语句前导注释，便于识别脚手架 SQL。 */
function stripLeadingSqlComments(sql: string): string {
  let s = sql.trim()
  for (;;) {
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n')
      if (nl < 0) return ''
      s = s.slice(nl + 1).trim()
      continue
    }
    if (s.startsWith('/*')) {
      const end = s.indexOf('*/')
      if (end < 0) return ''
      s = s.slice(end + 2).trim()
      continue
    }
    break
  }
  return s
}

/** 调试包装产生的脚手架语句（不应作为调用结果展示）。 */
export function isKingbaseDebugSessionScaffoldSql(sql: string): boolean {
  const s = stripLeadingSqlComments(sql)
  if (!s) return false
  const guc = NM_DEBUG_GUC.replace(/\./g, '\\.')
  if (new RegExp(`^SELECT\\s+set_config\\s*\\(\\s*'${guc}'`, 'i').test(s)) return true
  if (/^SET\s+client_min_messages\b/i.test(s)) return true
  return false
}

/** 重命名 CREATE PROCEDURE/FUNCTION 目标名（保留 schema 前缀）。 */
export function renameKingbaseRoutineInDdl(
  ddl: string,
  kind: 'procedure' | 'function',
  from: string,
  to: string,
): string {
  const kindPat = kind === 'function' ? 'function' : 'procedure'
  const fromEsc = escapeRegExp(from)
  const re = new RegExp(
    `(create\\s+(?:or\\s+replace\\s+)?${kindPat}\\s+)((?:"[^"]+"|[A-Za-z_][\\w$]*)\\s*\\.\\s*)?("${fromEsc}"|${fromEsc})(?=\\s*\\()`,
    'i',
  )
  return ddl.replace(re, (_m, head: string, schema: string | undefined, _name: string) => {
    const qTo = `"${to.replace(/"/g, '""')}"`
    return `${head}${schema ?? ''}${qTo}`
  })
}
