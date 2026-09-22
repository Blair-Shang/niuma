import { describe, expect, it } from 'vitest'
import {
  applySocketLineEnd,
  detectSocketEncode,
  isBase64Draft,
  isHexDraft,
  normalizeHexDraft,
} from './socket-payload'

describe('socket payload', () => {
  it('strips hex separators', () => {
    expect(normalizeHexDraft('48 65:6c\n6c 6f')).toBe('48656c6c6f')
  })

  it('rejects odd or non-hex drafts', () => {
    expect(isHexDraft('48656c6c6f')).toBe(true)
    expect(isHexDraft('486')).toBe(false)
    expect(isHexDraft('zz')).toBe(false)
    expect(isHexDraft('')).toBe(true)
  })

  it('accepts standard base64 and rejects plaintext', () => {
    expect(isBase64Draft('')).toBe(true)
    expect(isBase64Draft('cGluZw==')).toBe(true)
    expect(isBase64Draft('hello')).toBe(false)
    expect(isBase64Draft('abc')).toBe(false)
  })

  it('detects hex vs text like the backend', () => {
    expect(detectSocketEncode('70 69 6e 67')).toBe('hex')
    expect(detectSocketEncode('dfsfs')).toBe('utf8')
    expect(detectSocketEncode('')).toBe('utf8')
  })

  it('appends line endings in the selected encoding', () => {
    expect(applySocketLineEnd('ping', 'utf8', 'crlf')).toBe('ping\r\n')
    expect(applySocketLineEnd('70 69 6e 67', 'hex', 'lf')).toBe('70696e670a')
    expect(applySocketLineEnd('70 69 6e 67', 'auto', 'lf')).toBe('70696e670a')
    expect(applySocketLineEnd('ping', 'utf8', 'none')).toBe('ping')
    expect(applySocketLineEnd('cGluZw==', 'base64', 'none')).toBe('cGluZw==')
  })
})
