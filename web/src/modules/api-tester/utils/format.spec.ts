import { describe, expect, it } from 'vitest'
import {
  buildCurl,
  formatBytes,
  formatHexDump,
  newKvRow,
  prettyJson,
  statusTone,
} from './format'
import { interpolateVariables, resolveRequest } from '../http/request-resolve'
import { defaultAuth, minimalRequest } from './collection-io'
import type { ApiEnvironment, ApiRequest } from '../types'

const env: ApiEnvironment = {
  id: 'prod',
  name: 'Production',
  baseUrl: 'https://api.demo.local',
  vars: { baseUrl: 'https://api.demo.local' },
}

function sample(partial: Partial<ApiRequest> = {}): ApiRequest {
  return minimalRequest({
    id: '1',
    name: 'List',
    method: 'GET',
    url: '{{baseUrl}}/api/products',
    params: [newKvRow('limit', '20')],
    headers: [newKvRow('Accept', 'application/json')],
    ...partial,
  })
}

describe('api tester format', () => {
  it('interpolates baseUrl and builds query', () => {
    expect(interpolateVariables('{{baseUrl}}/x', env.vars)).toBe('https://api.demo.local/x')
    expect(resolveRequest(sample(), env).url).toBe('https://api.demo.local/api/products?limit=20')
  })

  it('skips disabled query rows', () => {
    const req = sample({ params: [newKvRow('limit', '20', false), newKvRow('q', 'probe')] })
    expect(resolveRequest(req, env).url).toBe('https://api.demo.local/api/products?q=probe')
  })

  it('builds curl and pretty json', () => {
    const req = sample({
      method: 'POST',
      bodyMode: 'json',
      body: '{"a":1}',
      headers: [newKvRow('Content-Type', 'application/json')],
    })
    const line = buildCurl(req, env)
    expect(line).toContain("-X POST")
    expect(line).toContain('https://api.demo.local/api/products')
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}')
  })

  it('formats size and hex dump', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    const dump = formatHexDump('Hi')
    expect(dump).toContain('48 69')
    expect(dump).toContain('Hi')
  })

  it('maps status tone', () => {
    expect(statusTone(200, true)).toBe('success')
    expect(statusTone(401, true)).toBe('warning')
    expect(statusTone(null, false)).toBe('danger')
    expect(statusTone(null, true)).toBe('success')
  })
})
