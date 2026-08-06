/** 判断 Oracle 错误是否像连接已断开（应关闭本地 session 并重连）。 */
export function isOracleConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const lower = message.toLowerCase()
  return (
    lower.includes('dpi-1080')
    || lower.includes('dpi-1010')
    || lower.includes('ora-03113')
    || lower.includes('ora-03114')
    || lower.includes('ora-03135')
    || lower.includes('ora-00028')
    || lower.includes('ora-01012')
    || lower.includes('connection was closed')
    || lower.includes('end-of-file on communication channel')
    || lower.includes('session closed, please reconnect')
    || lower.includes('session not found')
    || lower.includes('not connected to oracle')
  )
}
