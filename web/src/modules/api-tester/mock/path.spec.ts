import { describe, expect, it } from 'vitest'
import { pathOfUrl } from './path'

describe('mock path', () => {
  it('keeps the pathname of an absolute URL', () => {
    expect(pathOfUrl('https://example.com/v1/users?x=1')).toBe('/v1/users')
  })

  it('keeps a relative path', () => {
    expect(pathOfUrl('{{baseUrl}}/orders')).toBe('/orders')
    expect(pathOfUrl('')).toBe('/')
  })
})
