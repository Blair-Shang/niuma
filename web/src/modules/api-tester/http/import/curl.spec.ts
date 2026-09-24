import { describe, expect, it } from 'vitest'
import { parseCurl, tokenizeShell } from './curl'

describe('import curl', () => {
  it('tokenizes quotes, escapes, and line continuations', () => {
    expect(tokenizeShell("curl -H 'Accept: a'\n")).toEqual(['curl', '-H', 'Accept: a'])
    expect(tokenizeShell("curl -d '{\"a\":1}' \\\n  https://example.com/x")).toEqual([
      'curl',
      '-d',
      '{"a":1}',
      'https://example.com/x',
    ])
    expect(tokenizeShell("curl 'it'\\''s'")).toEqual(['curl', "it's"])
  })

  it('imports a GET with query and bearer', () => {
    const req = parseCurl(
      "curl 'https://api.example.com/v1/orders?limit=2' -H 'Authorization: Bearer {{token}}' -H 'Accept: application/json'",
    )
    expect(req?.method).toBe('GET')
    expect(req?.name).toBe('orders')
    expect(req?.url).toBe('https://api.example.com/v1/orders')
    expect(req?.params.map((row) => [row.key, row.value])).toEqual([['limit', '2']])
    expect(req?.auth).toEqual({ type: 'bearer', bearer: { token: '{{token}}' } })
    expect(req?.headers.some((row) => row.key.toLowerCase() === 'authorization')).toBe(false)
    expect(req?.headers.some((row) => row.key === 'Accept')).toBe(true)
  })

  it('imports JSON post, basic auth, and urlencoded data', () => {
    const json = parseCurl(`curl -X POST https://example.com/orders -H 'Content-Type: application/json' -d '{"sku":"a"}'`)
    expect(json?.method).toBe('POST')
    expect(json?.bodyMode).toBe('json')
    expect(json?.body).toBe('{"sku":"a"}')

    const basic = parseCurl("curl -u 'ada:s3cret' https://example.com/me")
    expect(basic?.auth).toEqual({ type: 'basic', basic: { username: 'ada', password: 's3cret' } })

    const form = parseCurl("curl -G --data-urlencode 'q=a b' https://example.com/search")
    expect(form?.method).toBe('GET')
    expect(form?.params.map((row) => [row.key, row.value])).toEqual([['q', 'a b']])
    expect(form?.bodyMode).toBe('none')

    const encoded = parseCurl("curl -d 'name=Ada&city=SH' https://example.com/users")
    expect(encoded?.method).toBe('POST')
    expect(encoded?.bodyMode).toBe('urlencoded')
    expect(encoded?.bodyForm?.map((row) => [row.key, row.value])).toEqual([
      ['name', 'Ada'],
      ['city', 'SH'],
    ])
  })

  it('rejects a command with no URL', () => {
    expect(parseCurl('curl -sS')).toBeNull()
    expect(parseCurl('')).toBeNull()
  })
})
