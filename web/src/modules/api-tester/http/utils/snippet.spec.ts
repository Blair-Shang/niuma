import { describe, expect, it } from 'vitest'
import { newKvRow } from '../../utils/format'
import { minimalRequest } from '../../utils/collection-io'
import type { ApiEnvironment, ApiRequest } from '../../types'
import { buildSnippet } from './snippet'

const env: ApiEnvironment = {
  id: 'local',
  name: 'Local',
  baseUrl: 'https://api.demo.local',
  vars: { baseUrl: 'https://api.demo.local', token: 'secret' },
}

function sample(partial: Partial<ApiRequest> = {}): ApiRequest {
  return minimalRequest({
    id: '1',
    name: 'Create',
    method: 'POST',
    url: '{{baseUrl}}/orders',
    headers: [newKvRow('Accept', 'application/json'), newKvRow('Authorization', 'Bearer {{token}}')],
    bodyMode: 'json',
    body: '{"sku":"a"}',
    ...partial,
  })
}

describe('http snippets', () => {
  it('builds a multiline curl with the resolved url and bearer', () => {
    const text = buildSnippet('curl', sample(), env)
    expect(text).toContain("curl -X POST 'https://api.demo.local/orders'")
    expect(text).toContain("-H 'Authorization: Bearer secret'")
    expect(text).toContain(`--data-raw '{"sku":"a"}'`)
    expect(text).toContain(' \\\n')
  })

  it('builds fetch, requests, and HttpClient for json', () => {
    expect(buildSnippet('javascript', sample(), env)).toContain('await fetch(')
    expect(buildSnippet('javascript', sample(), env)).toContain('JSON.stringify')
    expect(buildSnippet('python', sample(), env)).toContain('requests.request(')
    expect(buildSnippet('python', sample(), env)).toContain("'sku': 'a'")
    expect(buildSnippet('go', sample(), env)).toContain('http.NewRequest(')
    expect(buildSnippet('java', sample(), env)).toContain('HttpRequest.newBuilder()')
    expect(buildSnippet('php', sample(), env)).toContain('curl_init(')
    expect(buildSnippet('csharp', sample(), env)).toContain('HttpRequestMessage')
  })

  it('uses form fields instead of a raw multipart body', () => {
    const req = sample({
      bodyMode: 'form',
      body: '',
      bodyForm: [newKvRow('name', 'Ada'), newKvRow('city', 'SH')],
    })
    expect(buildSnippet('curl', req, env)).toContain("-F 'name=Ada'")
    expect(buildSnippet('curl', req, env)).not.toContain('Content-Type')
    expect(buildSnippet('javascript', req, env)).toContain('new FormData()')
    expect(buildSnippet('python', req, env)).toContain('files={')
  })

  it('omits a body on GET', () => {
    const text = buildSnippet('curl', sample({ method: 'GET', bodyMode: 'none', body: '' }), env)
    expect(text.startsWith('curl ')).toBe(true)
    expect(text).not.toContain('--data')
    expect(buildSnippet('javascript', sample({ method: 'GET', bodyMode: 'none', body: '' }), env)).not.toContain('body:')
  })
})
