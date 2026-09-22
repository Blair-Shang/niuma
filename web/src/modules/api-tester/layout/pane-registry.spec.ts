import { describe, expect, it } from 'vitest'
import { apiPaneRegistry, applyPaneDefaults, findPaneCreate, listApiPaneCreates, paneCreateKey, paneKindOf } from './pane-registry'
import type { ApiRequest } from './types'

describe('api pane registry', () => {
  it('exposes a static feature record', () => {
    expect(apiPaneRegistry.http.labelKey).toBe('modules.api.paneHttp')
    expect(apiPaneRegistry.socket.labelKey).toBe('modules.api.paneSocket')
  })

  it('maps methods to registered kinds', () => {
    expect(paneKindOf('GET')).toBe('http')
    expect(paneKindOf('TCP')).toBe('socket')
    expect(paneKindOf('UDP')).toBe('socket')
  })

  it('lists create actions from each pane', () => {
    const keys = listApiPaneCreates().map((item) => item.method)
    expect(keys).toContain('GET')
    expect(keys).toContain('TCP')
    expect(keys).toContain('UDP')
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

  it('resolves client and server socket panes separately', () => {
    const client = apiPaneRegistry.socket.resolvePane({ listen: false })
    const server = apiPaneRegistry.socket.resolvePane({ listen: true })
    expect(client.loader).not.toBe(server.loader)
  })

  it('applies listen address when creating a server', () => {
    const req: ApiRequest = {
      id: '1',
      name: 'x',
      method: 'TCP',
      url: '',
      params: [],
      headers: [],
      body: '',
    }
    applyPaneDefaults(req, { listen: true })
    expect(req.url).toBe('0.0.0.0:9000')
  })

  it('applies the same listen address for a UDP server', () => {
    const req: ApiRequest = {
      id: '2',
      name: 'udp',
      method: 'UDP',
      url: '',
      params: [],
      headers: [],
      body: '',
    }
    applyPaneDefaults(req, { listen: true })
    expect(req.url).toBe('0.0.0.0:9000')
    const client: ApiRequest = { ...req, url: '' }
    applyPaneDefaults(client, { listen: false })
    expect(client.url).toBe('127.0.0.1:9000')
  })
})
