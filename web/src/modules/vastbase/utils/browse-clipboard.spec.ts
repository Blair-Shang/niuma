import { describe, expect, it } from 'vitest'
import {
  formatRowsAsTsv,
  mapPasteToColumnRecords,
  parseClipboardMatrix,
} from './browse-clipboard'

describe('browse-clipboard', () => {
  it('formats rows as TSV', () => {
    expect(formatRowsAsTsv(['id', 'name'], [[1, 'a'], [2, 'b\tc']])).toBe(
      '1\ta\n2\t"b\tc"',
    )
  })

  it('parses TSV clipboard', () => {
    expect(parseClipboardMatrix('1\talice\n2\tbob')).toEqual([
      ['1', 'alice'],
      ['2', 'bob'],
    ])
  })

  it('maps paste by position', () => {
    expect(
      mapPasteToColumnRecords(
        ['id', 'name'],
        [
          ['10', 'x'],
          ['11', 'y'],
        ],
      ),
    ).toEqual([
      { id: '10', name: 'x' },
      { id: '11', name: 'y' },
    ])
  })

  it('maps paste by header names', () => {
    expect(
      mapPasteToColumnRecords(
        ['id', 'name', 'age'],
        [
          ['name', 'id'],
          ['alice', '1'],
        ],
      ),
    ).toEqual([{ name: 'alice', id: '1' }])
  })
})
