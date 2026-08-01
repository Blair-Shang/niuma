import { describe, expect, it } from 'vitest'
import {
  autoMatchColumns,
  firstCsvLine,
  parseCsvPreview,
  parseCsvSourceColumns,
  parseTsvPreview,
  splitCsvLine,
  splitCsvRecords,
  unescapeTsvField,
} from './csv-header'

describe('csv-header', () => {
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

  it('splits multiple records with quoted newlines', () => {
    expect(splitCsvRecords('a,b\n1,"x\ny"\n2,z', ',', 10)).toEqual([
      ['a', 'b'],
      ['1', 'x\ny'],
      ['2', 'z'],
    ])
  })

  it('parses preview with header', () => {
    const preview = parseCsvPreview('id,name\n1,a\n2,b\n3,c', { header: true, maxRows: 2 })
    expect(preview.columns).toEqual(['id', 'name'])
    expect(preview.rows).toEqual([
      ['1', 'a'],
      ['2', 'b'],
    ])
  })

  it('parses preview without header', () => {
    const preview = parseCsvPreview('1,a\n2,b', { header: false, maxRows: 5 })
    expect(preview.columns).toEqual(['col1', 'col2'])
    expect(preview.rows).toEqual([
      ['1', 'a'],
      ['2', 'b'],
    ])
  })

  it('unescapes clickhouse tsv fields', () => {
    expect(unescapeTsvField('hello\\tworld')).toBe('hello\tworld')
    expect(unescapeTsvField('a\\\\b')).toBe('a\\b')
  })

  it('parses tsv preview with escaped tab', () => {
    const preview = parseTsvPreview('id\tnote\n1\thello\\tworld', { header: true, maxRows: 5 })
    expect(preview.columns).toEqual(['id', 'note'])
    expect(preview.rows).toEqual([['1', 'hello\tworld']])
  })
})
