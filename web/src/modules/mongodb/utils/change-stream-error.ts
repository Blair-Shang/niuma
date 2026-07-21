/**
 * 将 Change Stream 启动错误映射为面向用户的提示。
 */
export function formatChangeStreamStartError(message: string, fallback: string): string {
  const lower = message.toLowerCase()
  if (
    lower.includes('only supported on replica sets')
    || lower.includes('location40573')
    || lower.includes('replica set')
  ) {
    return 'REPLICA_SET_REQUIRED'
  }
  return message.trim() || fallback
}

export function isReplicaSetRequiredError(code: string): boolean {
  return code === 'REPLICA_SET_REQUIRED'
}
