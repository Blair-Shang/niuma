import { describe, expect, it } from 'vitest'
import type { ApiRequest } from '../types'
import { newKvRow } from './format'
import { applyPaneMethod } from '../pane-registry'
import { joinSocketUrl, looksLikeHttpUrl, splitSocketUrl } from './request-kind'

function sample(partial: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'req-1',
    name: 'Untitled',
    method: 'GET',
    url: '{{baseUrl}}/api/items',
    params: [newKvRow('q', '1')],
    headers: [newKvRow('Accept', 'application/json')],
    body: '',
    ...partial,
  }
}

describe('applyPaneMethod', () => {
  it('resets HTTP path when switching to TCP', () => {
    const req = sample()
    applyPaneMethod(req, 'TCP')
    expect(req.method).toBe('TCP')
    expect(req.url).toBe('127.0.0.1:9000')
    expect(req.params).toEqual([])
    expect(req.headers).toEqual([])
  })

  it('keeps host:port when switching UDP to GET', () => {
    const req = sample({ method: 'UDP', url: '10.0.0.2:9000', params: [], headers: [] })
    applyPaneMethod(req, 'GET')
    expect(req.url).toBe('{{baseUrl}}')
    expect(req.headers[0]?.key).toBe('Accept')
  })

  it('detects interpolated HTTP urls', () => {
    expect(looksLikeHttpUrl('{{baseUrl}}/v1')).toBe(true)
    expect(looksLikeHttpUrl('127.0.0.1:9000')).toBe(false)
  })

  it('splits and joins listen urls', () => {
    expect(splitSocketUrl('listen://10.0.0.8:9000')).toMatchObject({
      host: '10.0.0.8',
      port: '9000',
      listen: true,
    })
    expect(joinSocketUrl('10.0.0.8', '9000', true)).toBe('listen://10.0.0.8:9000')
    expect(joinSocketUrl('0.0.0.0', '9000', true)).toBe('0.0.0.0:9000')
  })
})
