/** 从 ssh/sftp 建连错误里解析主机密钥拒绝信息。 */
export interface HostKeyRejectedInfo {
  host: string
  port: number
  fingerprint: string
  algorithm: string
  reason: string
}

const HOSTKEY_REJECTED_RE =
  /host key rejected for ([^\s:]+):(\d+)\s+fingerprint=(\S+)\s+algo=(\S+)\s+reason=(\S+)/i

/** parseHostKeyRejected 从能力服务错误字符串提取指纹与主机。 */
export function parseHostKeyRejected(message: string): HostKeyRejectedInfo | null {
  const match = message.match(HOSTKEY_REJECTED_RE)
  if (!match) {
    return null
  }
  return {
    host: match[1],
    port: Number(match[2]),
    fingerprint: match[3],
    algorithm: match[4],
    reason: match[5],
  }
}
