import { describe, expect, it } from 'vitest'
import { toHistoryItem, toHistorySummary } from './history-map'

describe('history-map', () => {
  it('keeps list summaries without parsing bodies', () => {
    const item = toHistorySummary({
      historyId: 'h1',
      workspaceId: 'default',
      requestId: 'r1',
      requestName: 'List',
      httpMethod: 'GET',
      requestUrl: 'https://example.test',
      environmentId: '',
      environmentName: '',
      durationMs: 12,
      httpStatus: 200,
      createdAt: '2026-03-12T00:00:00Z',
    })
    expect(item.request).toBeNull()
    expect(item.exchange).toBeNull()
    expect(item.method).toBe('GET')
  })

  it('parses a full snapshot only when json is present', () => {
    const item = toHistoryItem({
      historyId: 'h1',
      workspaceId: 'default',
      requestId: 'r1',
      requestName: 'List',
      httpMethod: 'POST',
      requestUrl: 'https://example.test',
      environmentId: '',
      environmentName: '',
      durationMs: 12,
      httpStatus: 201,
      createdAt: '2026-03-12T00:00:00Z',
      requestJson: { id: 'r1', name: 'Create', method: 'POST', url: '/x', body: '{"a":1}' },
      exchangeJson: { ok: true, status: 201, body: '{"id":1}' },
    })
    expect(item.request?.body).toBe('{"a":1}')
    expect(item.exchange?.body).toBe('{"id":1}')
  })
})
