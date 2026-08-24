/**
 * SQL Server 调试辅助：日志点草稿（只生成文本，不执行 DDL）。
 * 对齐 MySQL DebugPane「调用 + 观测」，不是 SSMS 断点调试器。
 */

export const NM_DEBUG_SESSION_VAR = '@nm_debug'
export const NM_DEBUG_POINT_MARKER = '/* nm-debug-point */'

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''")
}

/** 已有调试日志点数量。 */
export function countSqlServerDebugLogPoints(sql: string): number {
  return (sql.match(/\/\*\s*nm-debug-point(?:\s*:[^*]*)?\s*\*\//gi) ?? []).length
}

function buildLogBlock(kind: 'procedure' | 'function', label: string): string {
  const safe = escapeSqlString(label)
  const marker = `  /* nm-debug-point: ${safe} */`
  if (kind === 'function') {
    return [
      marker,
      `  IF ISNULL(${NM_DEBUG_SESSION_VAR}, 0) <> 0`,
      `    PRINT N'nm_debug_point:${safe}';`,
    ].join('\n')
  }
  return [
    marker,
    `  IF ISNULL(${NM_DEBUG_SESSION_VAR}, 0) <> 0`,
    `    SELECT N'${safe}' AS [nm_debug_point], SYSDATETIME() AS [nm_debug_at];`,
  ].join('\n')
}

function insertAfterBodyStart(src: string, block: string): string {
  const begin = /\bBEGIN\b/i.exec(src)
  if (begin) {
    const insertAt = begin.index + begin[0].length
    const after = src.slice(insertAt)
    return src.slice(0, insertAt) + '\n' + block + (after.startsWith('\n') ? after : `\n${after}`)
  }
  const as = /\bAS\b/i.exec(src)
  if (as) {
    const insertAt = as.index + as[0].length
    const after = src.slice(insertAt)
    return src.slice(0, insertAt) + '\n' + block + (after.startsWith('\n') ? after : `\n${after}`)
  }
  return `${src.trimEnd()}\n-- nm-debug: BEGIN/AS not found; append manually:\n${block}\n`
}

/** 在首个 BEGIN（或 AS）后插入日志点。 */
export function insertSqlServerDebugLogPoint(
  ddl: string,
  options: { kind: 'procedure' | 'function'; label?: string },
): string {
  const src = ddl ?? ''
  const n = countSqlServerDebugLogPoints(src) + 1
  const label = (options.label || `point_${n}`).trim() || `point_${n}`
  return insertAfterBodyStart(src, buildLogBlock(options.kind, label))
}

/** 在指定行后插入日志点（1-based）。 */
export function insertSqlServerDebugLogPointAtLine(
  ddl: string,
  options: { kind: 'procedure' | 'function'; line: number; label?: string },
): string {
  const src = ddl ?? ''
  if (!src.trim() || options.line < 1) {
    return insertSqlServerDebugLogPoint(src, options)
  }
  const n = countSqlServerDebugLogPoints(src) + 1
  const label = (options.label || `point_${n}`).trim() || `point_${n}`
  const block = buildLogBlock(options.kind, label)
  const lines = src.split('\n')
  const idx = Math.min(Math.max(options.line, 1), lines.length) - 1
  return [...lines.slice(0, idx + 1), block, ...lines.slice(idx + 1)].join('\n')
}

/** 调用脚本前开启 @nm_debug（与 DECLARE/EXEC 同一批）。 */
export function wrapSqlServerCallWithDebugSession(callSql: string): string {
  const body = (callSql ?? '').trim()
  if (!body) return body
  if (new RegExp(`DECLARE\\s+${NM_DEBUG_SESSION_VAR}\\b`, 'i').test(body)) {
    return `${body}\n`
  }
  const gate = `DECLARE ${NM_DEBUG_SESSION_VAR} bit = 1;`
  if (/^\s*SET\s+NOCOUNT\s+ON\b/i.test(body)) {
    const nl = body.indexOf('\n')
    if (nl >= 0) {
      return `${body.slice(0, nl + 1)}${gate}\n${body.slice(nl + 1)}\n`
    }
  }
  return `SET NOCOUNT ON;\n${gate}\n${body}\n`
}
