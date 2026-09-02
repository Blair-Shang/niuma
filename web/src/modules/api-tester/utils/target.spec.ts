import { describe, expect, it } from 'vitest'
import { parseRemoteAddr, parseTarget, resolveSocketSendDest, socketOpenFields, TargetError } from './target'

describe('api tester target', () => {
  it('parses tcp and udp host:port', () => {
    expect(parseTarget('10.0.0.8:9000', 'TCP')).toMatchObject({
      transport: 'tcp-client',
      host: '10.0.0.8',
      port: 9000,
      http: false,
      protocol: 'TCP',
    })
    expect(parseTarget('udp://127.0.0.1:5353/ignored', 'UDP')).toMatchObject({
      transport: 'udp',
      host: '127.0.0.1',
      port: 5353,
    })
    expect(parseTarget('[::1]:9000', 'TCP').host).toBe('::1')
    expect(parseTarget('[::1]:9000', 'TCP').listen).toBe(false)
  })

  it('treats wildcard and listen:// as bind', () => {
    expect(parseTarget('0.0.0.0:9000', 'TCP')).toMatchObject({
      transport: 'tcp-server',
      host: '0.0.0.0',
      port: 9000,
      listen: true,
    })
    expect(parseTarget('*:5353', 'UDP')).toMatchObject({
      transport: 'udp',
      host: '0.0.0.0',
      port: 5353,
      listen: true,
    })
    expect(parseTarget('listen://127.0.0.1:9000', 'TCP')).toMatchObject({
      transport: 'tcp-server',
      host: '127.0.0.1',
      listen: true,
    })
    expect(parseTarget('[::]:9000', 'TCP')).toMatchObject({
      transport: 'tcp-server',
      host: '::',
      listen: true,
    })
    expect(parseTarget(':9000', 'TCP')).toMatchObject({
      transport: 'tcp-server',
      host: '0.0.0.0',
      listen: true,
    })
  })

  it('parses plaintext HTTP', () => {
    expect(parseTarget('http://example.com/api/items?q=1', 'GET')).toMatchObject({
      transport: 'tcp-client',
      host: 'example.com',
      port: 80,
      path: '/api/items?q=1',
      http: true,
    })
    expect(parseTarget('127.0.0.1:8080/health', 'POST')).toMatchObject({
      host: '127.0.0.1',
      port: 8080,
      path: '/health',
      http: true,
    })
  })

  it('rejects https websocket and bare host', () => {
    expect(() => parseTarget('https://example.com', 'GET')).toThrow(TargetError)
    expect(() => parseTarget('ws://example.com', 'WS')).toThrow(TargetError)
    expect(() => parseTarget('10.0.0.8', 'TCP')).toThrow(TargetError)
  })

  it('parses inbound remote addrs and ignores wildcards', () => {
    expect(parseRemoteAddr('10.0.0.8:54321')).toEqual({ host: '10.0.0.8', port: 54321 })
    expect(parseRemoteAddr('[::1]:9000')).toEqual({ host: '::1', port: 9000 })
    expect(parseRemoteAddr('0.0.0.0:9000')).toBeNull()
    expect(parseRemoteAddr('')).toBeNull()
  })

  it('opens UDP listen on local bind and replies to the peer', () => {
    const listen = parseTarget('0.0.0.0:9000', 'UDP')
    expect(socketOpenFields(listen)).toEqual({ localHost: '0.0.0.0', localPort: 9000 })
    expect(resolveSocketSendDest(listen, '10.0.0.8:54321')).toEqual({ host: '10.0.0.8', port: 54321 })
    expect(resolveSocketSendDest(listen)).toBeUndefined()

    const nic = parseTarget('listen://10.0.0.8:9000', 'UDP')
    expect(socketOpenFields(nic)).toEqual({ localHost: '10.0.0.8', localPort: 9000 })

    const client = parseTarget('127.0.0.1:9000', 'UDP')
    expect(socketOpenFields(client)).toEqual({ host: '127.0.0.1', port: 9000 })
    expect(resolveSocketSendDest(client, 'ignored:1')).toEqual({ host: '127.0.0.1', port: 9000 })
  })
})
