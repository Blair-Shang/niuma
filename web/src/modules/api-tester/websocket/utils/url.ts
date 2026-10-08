/**
 * WebSocket 地址。只接受 ws / wss，缺省补 ws://。
 */
export function parseWebSocketURL(raw: string): { url: string; host: string; port: number } {
  let text = raw.trim()
  if (!text) throw new Error('empty url')
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) text = `ws://${text}`
  const parsed = new URL(text)
  const scheme = parsed.protocol.replace(/:$/, '')
  if (scheme !== 'ws' && scheme !== 'wss') throw new Error(`unsupported scheme ${scheme}`)
  const port = parsed.port ? Number(parsed.port) : scheme === 'wss' ? 443 : 80
  if (!parsed.hostname || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('invalid host or port')
  }
  return { url: parsed.href, host: parsed.hostname, port }
}

export function splitProtocols(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
