import { describe, expect, it } from 'vitest'
import {
  normalizeVastClientEncoding,
  parseStatementTimeoutMs,
} from '@/modules/vastbase/vast-encoding'
import { vastbaseConnectionFormAdapter } from '@/modules/vastbase/connection-form-adapter'

describe('vastbase encoding helpers', () => {
  it('normalizes client encoding', () => {
    expect(normalizeVastClientEncoding('')).toBe('UTF8')
    expect(normalizeVastClientEncoding('GBK')).toBe('GBK')
    expect(normalizeVastClientEncoding('bad enc')).toBe('UTF8')
  })

  it('parses statement timeout', () => {
    expect(parseStatementTimeoutMs('')).toBe(0)
    expect(parseStatementTimeoutMs('1500')).toBe(1500)
    expect(parseStatementTimeoutMs('-1')).toBe(0)
  })
})

describe('vastbase connection form adapter', () => {
  it('persists ssl files and advanced options', () => {
    const form = {
      ...vastbaseConnectionFormAdapter.defaults(),
      vastDatabase: 'app',
      vastSslMode: 'verify-full',
      vastSslRootCert: 'C:\\ca.pem',
      vastSslCert: 'C:\\client.crt',
      vastSslKey: 'C:\\client.key',
      vastSearchPath: 'public,app',
      vastClientEncoding: 'UTF8',
      vastStatementTimeoutMs: '3000',
      vastExcludeSystemSchemas: 'true',
      connectTimeoutSeconds: '10',
    } as never
    const opts = vastbaseConnectionFormAdapter.buildOptions({
      form,
      accent: {},
      proxy: { type: 'none' },
      tunnel: undefined,
    }) as {
      ssl_mode: string
      ssl_root_cert: string
      ssl_cert: string
      ssl_key: string
      search_path: string
      client_encoding: string
      statement_timeout_ms: number
    }
    expect(opts.ssl_mode).toBe('verify-full')
    expect(opts.ssl_root_cert).toBe('C:\\ca.pem')
    expect(opts.ssl_cert).toBe('C:\\client.crt')
    expect(opts.ssl_key).toBe('C:\\client.key')
    expect(opts.search_path).toBe('public,app')
    expect(opts.client_encoding).toBe('UTF8')
    expect(opts.statement_timeout_ms).toBe(3000)
  })
})
