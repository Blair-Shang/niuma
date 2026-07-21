/**
 * SQL*Plus / gsql 风格独立行结束符 `/`。
 * 是否剥离由会话 Capability `script.oracle_slash` 决定（见 prepareDialectExecSql）。
 */
export function stripOracleScriptTerminator(sql: string): string {
  const trimmed = sql.replace(/[ \t\r\n]+$/u, '')
  if (!trimmed) return trimmed
  const lines = trimmed.split('\n')
  if (lines[lines.length - 1]?.trim() !== '/') return trimmed
  return lines.slice(0, -1).join('\n').replace(/[ \t\r\n]+$/u, '')
}

/** @deprecated 使用 prepareDialectExecSql */
export function prepareVastbaseExecSql(sql: string): string {
  return prepareDialectExecSql(sql, { stripOracleSlash: true })
}

/** 按方言能力规范化待执行 SQL。 */
export function prepareDialectExecSql(
  sql: string,
  opts: { stripOracleSlash?: boolean } = {},
): string {
  let out = sql
  if (opts.stripOracleSlash) {
    out = stripOracleScriptTerminator(out)
  }
  return out.trim()
}
