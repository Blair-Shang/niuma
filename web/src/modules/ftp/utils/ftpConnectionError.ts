/** 判断 FTP Bridge 错误是否像物理连接已断开（可尝试自动重连）。 */
export function isFtpConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const lower = message.toLowerCase()
  return (
    lower.includes('connection was aborted')
    || lower.includes('connection reset')
    || lower.includes('broken pipe')
    || lower.includes('eof')
    || lower.includes('use of closed network connection')
    || lower.includes('wsasend')
    || lower.includes('wsarecv')
    || lower.includes('i/o timeout')
    || lower.includes('session not found')
  )
}
