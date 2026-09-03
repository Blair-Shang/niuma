import { describe, expect, it } from 'vitest'
import { decodeSshTerminalData, resolveSshTextEncoding } from './terminal-data'

function toB64(text: string): string {
  return btoa(text)
}

describe('ssh terminal data', () => {
  it('resolves gbk aliases', () => {
    expect(resolveSshTextEncoding('GBK')).toBe('gbk')
    expect(resolveSshTextEncoding('gb18030')).toBe('gbk')
    expect(resolveSshTextEncoding('utf-8')).toBe('utf-8')
  })

  it('decodes base64 utf-8 including ESC', () => {
    const payload = `\x1b[31mhi\x1b[0m`
    const text = decodeSshTerminalData({ encoding: 'base64', data: toB64(payload) }, 'utf-8')
    expect(text).toBe(payload)
  })

  it('falls back to utf-8 text when encoding is omitted', () => {
    expect(decodeSshTerminalData({ data: 'plain' }, 'utf-8')).toBe('plain')
  })
})
