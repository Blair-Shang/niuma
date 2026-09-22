import { describe, expect, it } from 'vitest'
import { API_PANE_KIND_DEFS, applyPaneDefaults, findPaneCreate, listApiPaneCreates, paneCreateKey, paneKindOf } from './pane-registry'
import { ensureApiPane, getApiPaneRuntime } from './pane-kind-loaders'
import { registerBuiltinApiPaneLoaders } from './register-builtin-panes'
import { minimalRequest } from '../utils/collection-io'

describe('api pane registry', () => {
  it('exposes static kind defs without loading workspaces', () => {
    expect(API_PANE_KIND_DEFS.map((def) => def.kind)).toEqual(['http', 'tcp', 'udp', 'websocket'])
  })

  it('maps methods to registered kinds', () => {
    expect(paneKindOf('GET')).toBe('http')
    expect(paneKindOf('TCP')).toBe('tcp')
    expect(paneKindOf('UDP')).toBe('udp')
    expect(paneKindOf('WS')).toBe('websocket')
  })

  it('lists create actions from catalog, not websocket', () => {
    const keys = listApiPaneCreates().map((item) => item.method)
    expect(keys).toContain('GET')
    expect(keys).toContain('TCP')
    expect(keys).toContain('UDP')
    expect(keys).not.toContain('WS')
  })

  it('nests TCP and UDP client/server creates', () => {
    const tcp = listApiPaneCreates().find((item) => item.method === 'TCP')
    expect(tcp?.children?.map((item) => item.listen)).toEqual([false, true])
    expect(tcp?.children?.[1]?.nameKey).toBe('modules.api.nameTcpServer')
    const udp = listApiPaneCreates().find((item) => item.method === 'UDP')
    expect(udp?.children?.map((item) => item.listen)).toEqual([false, true])
    const server = tcp?.children?.[1]
    expect(server && findPaneCreate(paneCreateKey(server))?.listen).toBe(true)
  })

  it('loads protocol register() before resolving panes', async () => {
    registerBuiltinApiPaneLoaders()
    await ensureApiPane('tcp')
    await ensureApiPane('udp')
    const tcpClient = getApiPaneRuntime('tcp').resolvePane({ listen: false })
    const tcpServer = getApiPaneRuntime('tcp').resolvePane({ listen: true })
    const udpServer = getApiPaneRuntime('udp').resolvePane({ listen: true })
    expect(tcpClient.loader).not.toBe(tcpServer.loader)
    expect(udpServer.loader).not.toBe(tcpClient.loader)
  })

  it('applies listen address when creating a server', () => {
    const req = minimalRequest({ id: '1', name: 'x', method: 'TCP' })
    applyPaneDefaults(req, { listen: true })
    expect(req.url).toBe('0.0.0.0:9000')
  })

  it('applies the same listen address for a UDP server', () => {
    const req = minimalRequest({ id: '2', name: 'udp', method: 'UDP' })
    applyPaneDefaults(req, { listen: true })
    expect(req.url).toBe('0.0.0.0:9000')
    const client = minimalRequest({ ...req, url: '' })
    applyPaneDefaults(client, { listen: false })
    expect(client.url).toBe('127.0.0.1:9000')
  })
})
