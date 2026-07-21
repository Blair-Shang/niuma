/**
 * Mongo Shell 补全前缀：顶层助手（show da / use xxx）按整句替换；
 * db.xxx 只替换最后一个标识符（getc → getCollection），不要把 db. 算进前缀。
 */
export function resolveMongoShellCompletionPrefix(linePrefix: string): string {
  const stmt = statementPrefix(linePrefix)
  if (isShellHelperStatement(stmt) || shouldUseStatementPrefix(stmt)) {
    return stmt
  }
  // 仅取最后一个标识符片段（不含 `.`）
  let start = linePrefix.length
  while (start > 0 && /[\w$]/.test(linePrefix[start - 1] ?? '')) start -= 1
  return linePrefix.slice(start)
}

function statementPrefix(line: string): string {
  let start = 0
  for (let i = line.length - 1; i >= 0; i -= 1) {
    if (line[i] === ';') {
      start = i + 1
      break
    }
  }
  return line.slice(start).replace(/^\s+/, '')
}

function isShellHelperStatement(stmt: string): boolean {
  return /^(show|use|help|exit|it)\b/i.test(stmt)
}

function shouldUseStatementPrefix(stmt: string): boolean {
  if (!stmt) return true
  return !/[.({]/.test(stmt)
}
