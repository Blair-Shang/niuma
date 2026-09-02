import { describe, expect, it } from 'vitest'
import { i18n } from '@/locale'
import type { ApiRequest } from '../types'
import { tabTitle, tabTooltip } from './tab-chrome'

function sample(partial: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r1',
    name: 'demo',
    method: 'GET',
    url: '{{baseUrl}}',
    params: [],
    headers: [],
    body: '',
    ...partial,
  }
}

describe('tab chrome', () => {
  it('uses the request name as the tab title', () => {
    expect(tabTitle(sample({ name: 'TCP 服务端' }))).toBe('TCP 服务端')
  })

  it('marks listen sockets as server in the tooltip', () => {
    const tip = tabTooltip(sample({ method: 'TCP', name: 'demo', url: '0.0.0.0:9000' }))
    expect(tip.split('\n')[0]).toBe('demo')
    expect(tip).toContain('TCP')
    expect(tip).toContain(String(i18n.global.t('modules.api.socketServer')))
    expect(tip).not.toContain(String(i18n.global.t('modules.api.socketClient')))
  })

  it('marks dial sockets as client in the tooltip', () => {
    const tip = tabTooltip(sample({ method: 'UDP', name: 'demo', url: '127.0.0.1:9000' }))
    expect(tip).toContain('UDP')
    expect(tip).toContain(String(i18n.global.t('modules.api.socketClient')))
  })

  it('keeps HTTP tooltips on method and url', () => {
    const tip = tabTooltip(sample({ method: 'POST', name: 'create', url: '{{baseUrl}}/v1' }))
    expect(tip).toBe('create\nPOST\n{{baseUrl}}/v1')
  })
})
