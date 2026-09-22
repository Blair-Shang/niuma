import { describe, expect, it } from 'vitest'
import { newKvRow } from '../utils/format'
import { buildVariableContext, buildVariableMap, folderVariableChain, interpolateVariables, resolveRequest } from './request-resolve'
import type { ApiFolder, ApiRequest } from '../types'

const folders: ApiFolder[] = [
  { id: 'root', name: 'Root', parentId: null, vars: { org: 'acme' }, requests: [] },
  { id: 'child', name: 'Child', parentId: 'root', vars: { apiPrefix: '/v1' }, requests: [] },
]

describe('request-resolve', () => {
  it('merges globals, folder chain, and environment vars', () => {
    const map = buildVariableMap(
      buildVariableContext({
        globals: { vars: { envName: 'dev' } },
        folders,
        folderId: 'child',
        environment: {
          id: 'e1',
          name: 'Dev',
          baseUrl: 'http://127.0.0.1:8080',
          vars: { token: 't1', baseUrl: 'http://127.0.0.1:8080' },
        },
      }),
    )
    expect(map.org).toBe('acme')
    expect(map.apiPrefix).toBe('/v1')
    expect(map.token).toBe('t1')
    expect(map.baseUrl).toBe('http://127.0.0.1:8080')
    expect(map.envName).toBe('dev')
  })

  it('interpolates unknown tokens verbatim', () => {
    expect(interpolateVariables('{{a}}/{{missing}}', { a: '1' })).toBe('1/{{missing}}')
  })

  it('walks folder parent chain root to leaf', () => {
    expect(folderVariableChain(folders, 'child').map((row) => row.org ?? row.apiPrefix)).toEqual(['acme', '/v1'])
  })

  it('resolveRequest interpolates url, params, and auth together', () => {
    const req: ApiRequest = {
      id: 'r1',
      name: 'Hit',
      method: 'GET',
      url: '{{baseUrl}}{{apiPrefix}}/items',
      params: [newKvRow('limit', '20')],
      headers: [newKvRow('Accept', 'application/json')],
      auth: { type: 'bearer', bearer: { token: '{{token}}' } },
      bodyMode: 'none',
      body: '',
      bodyForm: [],
    }
    const resolved = resolveRequest(req, {
      id: 'e1',
      name: 'Dev',
      baseUrl: 'http://127.0.0.1:8080',
      vars: { token: 'abc', baseUrl: 'http://127.0.0.1:8080' },
    }, { folders, folderId: 'child' })
    expect(resolved.url).toBe('http://127.0.0.1:8080/v1/items?limit=20')
    expect(resolved.headers.get('authorization')).toBe('Bearer abc')
    expect(resolved.headers.get('accept')).toBe('application/json')
  })
})
