import { describe, expect, it } from 'vitest'
import { parseDataRows } from './data-file'

describe('run data file', () => {
  it('reads csv headers and json rows', () => {
    expect(parseDataRows('name,city\nAda,SH\n"Lin, Bo",HZ\n')).toEqual([
      { name: 'Ada', city: 'SH' },
      { name: 'Lin, Bo', city: 'HZ' },
    ])
    expect(parseDataRows('[{"sku":"a","n":2}]')).toEqual([{ sku: 'a', n: '2' }])
  })
})
