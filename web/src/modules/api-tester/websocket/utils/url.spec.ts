import { describe, expect, it } from 'vitest'
import { parseWebSocketURL, splitProtocols } from './url'

describe('websocket url', () => {
  it('defaults a bare host to ws and keeps the path', () => {
    expect(parseWebSocketURL('127.0.0.1:8080/chat')).toEqual({
      url: 'ws://127.0.0.1:8080/chat',
      host: '127.0.0.1',
      port: 8080,
    })
  })

  it('uses 443 for wss without a port', () => {
    expect(parseWebSocketURL('wss://example.com/socket').port).toBe(443)
  })

  it('splits subprotocols', () => {
    expect(splitProtocols(' chat, soap ')).toEqual(['chat', 'soap'])
  })
})
