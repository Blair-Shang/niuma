import type { SshRemoteEncoding, SshTerminalDataEvent } from '@/api/types/ssh'

/** 把 profile.encoding 收成 Web 实际使用的解码标签。 */
export function resolveSshTextEncoding(raw: unknown): SshRemoteEncoding {
  const value = String(raw ?? 'utf-8').trim().toLowerCase()
  if (value === 'gbk' || value === 'gb18030' || value === 'gb2312') {
    return 'gbk'
  }
  return 'utf-8'
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** decodeSshTerminalData 将服务端 PTY 事件还原为 xterm 可写的文本。 */
export function decodeSshTerminalData(
  event: Pick<SshTerminalDataEvent, 'data' | 'encoding'>,
  textEncoding: SshRemoteEncoding = 'utf-8',
): string {
  const bytes =
    event.encoding === 'base64'
      ? base64ToBytes(event.data)
      : new TextEncoder().encode(event.data)
  const label = textEncoding === 'gbk' ? 'gbk' : 'utf-8'
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }
}
