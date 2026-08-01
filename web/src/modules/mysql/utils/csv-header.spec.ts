import { describe, expect, it } from 'vitest'
import {
  autoMatchColumns,
  firstCsvLine,
  parseCsvSourceColumns,
  splitCsvLine,
} from './csv-header'

describe('csv-header (mysql re-export)', () => {
  it('splits quoted fields', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
    expect(splitCsvLine('a,"b""c",d')).toEqual(['a', 'b"c', 'd'])
  })

  it('strips bom and takes first line', () => {
    expect(firstCsvLine('\uFEFFid,name\n1,x')).toBe('id,name')
  })

  it('parses header vs synthetic cols', () => {
    expect(parseCsvSourceColumns('id,name\n1,a', { header: true })).toEqual(['id', 'name'])
    expect(parseCsvSourceColumns('1,a\n2,b', { header: false })).toEqual(['col1', 'col2'])
  })

  it('auto-matches case-insensitively', () => {
    expect(autoMatchColumns(['ID', 'x'], ['id', 'name'])).toEqual({ ID: 'id' })
  })
})
