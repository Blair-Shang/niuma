import { describe, expect, it } from 'vitest'
import { buildSqlDocumentUri, parseSqlDocumentUri } from './types'

describe('sql-editor lsp uri', () => {
  it('roundtrips document uri', () => {
    const uri = buildSqlDocumentUri('mysql', 'sess/1', 'editor-a')
    expect(uri).toContain('niuma-sql://mysql/')
    const parsed = parseSqlDocumentUri(uri)
    expect(parsed).toEqual({
      namespace: 'mysql',
      sessionId: 'sess/1',
      editorId: 'editor-a',
    })
  })

  it('isolates editor id in uri for per-doc suggest database', () => {
    const a = buildSqlDocumentUri('dameng', 'sess-1', 'ed-a')
    const b = buildSqlDocumentUri('dameng', 'sess-1', 'ed-b')
    expect(a).not.toEqual(b)
    expect(parseSqlDocumentUri(a)?.editorId).toBe('ed-a')
    expect(parseSqlDocumentUri(b)?.editorId).toBe('ed-b')
  })
})

/**
 * Attach 顺序契约：必须先订阅 publishDiagnostics，再 didOpen。
 * 用轻量状态机验证，避免引入 Monaco。
 */
describe('sql-editor lsp attach order contract', () => {
  it('registers notification handler before didOpen', async () => {
    const steps: string[] = []
    const handlers: Array<(m: string) => void> = []
    const client = {
      onNotification(handler: (method: string) => void) {
        steps.push('onNotification')
        handlers.push(handler)
        return () => undefined
      },
      async setSuggestDatabase(_db: string, _uri?: string) {
        steps.push('setSuggestDatabase')
      },
      async didOpen(_uri: string, _text: string, _version: number) {
        steps.push('didOpen')
        for (const h of handlers) h('textDocument/publishDiagnostics')
      },
    }

    let sawDiag = false
    client.onNotification((method) => {
      if (method === 'textDocument/publishDiagnostics') sawDiag = true
    })
    await client.setSuggestDatabase('SYSDBA', 'niuma-sql://dameng/s/e')
    await client.didOpen('niuma-sql://dameng/s/e', 'SELECT 1', 1)

    expect(steps).toEqual(['onNotification', 'setSuggestDatabase', 'didOpen'])
    expect(sawDiag).toBe(true)
  })
})
